import { Injectable } from '@nestjs/common';
import {
  AlreadyExists,
  BusinessRuleViolation,
  InvalidInput,
  NotFound,
} from '@codementor/kernel';
import { requireHumanId, type AuthenticatedUser } from '@codementor/platform';
import {
  CERTIFICATE_CODE,
  generateCertificateCode,
  normalizeRecipientName,
} from '../domain/certificate-claim';
import type { CertificateDesign } from '../domain/certificate-design';
import {
  CertificateStore,
  type CertificateData,
  type CertificateRow,
} from '../infrastructure/certificate.store';
import type { CertificateSubject } from '../infrastructure/certificate-template.store';

/** Mã giữ chỗ trong bản xem trước — mã thật chỉ sinh lúc xác nhận. */
const PREVIEW_CODE = 'XXXXXXXXXX';

export interface CertificateView {
  id: string;
  code: string;
  subject: CertificateSubject;
  subjectId: string;
  recipientName: string;
  data: CertificateData;
  design: CertificateDesign;
  issuedAt: Date;
}

export type CertificateStatus =
  | { status: 'locked'; progressPercent: number; preview: { design: CertificateDesign; data: CertificateData } }
  | { status: 'claimable'; preview: { design: CertificateDesign; data: CertificateData } }
  | { status: 'issued'; certificate: CertificateView };

const toView = (row: CertificateRow): CertificateView => ({
  id: row.id,
  code: row.code,
  subject: row.subject,
  subjectId: row.subjectId,
  recipientName: row.recipientName,
  data: row.data,
  design: row.design,
  issuedAt: row.issuedAt,
});

@Injectable()
export class CertificateUseCases {
  constructor(private readonly store: CertificateStore) {}

  /**
   * Mục "Chứng chỉ" trên trang khóa học/lộ trình. Luôn kèm bản xem trước — kể cả khi chưa
   * hoàn thành — để học viên thấy trước thứ họ đang hướng tới.
   */
  async status(user: AuthenticatedUser, subject: CertificateSubject, id: string): Promise<CertificateStatus> {
    const userId = requireHumanId(user);
    const existing = await this.store.findActive(userId, subject, id);
    if (existing) return { status: 'issued', certificate: toView(existing) };

    const [info, completion] = await Promise.all([
      this.mustFindSubject(subject, id),
      this.store.completion(userId, subject, id),
    ]);
    const preview = {
      design: info.design,
      data: this.data(subject, info, completion, user.displayName, PREVIEW_CODE, new Date()),
    };
    if (completion?.status !== 'completed') {
      return { status: 'locked', progressPercent: completion?.progressPercent ?? 0, preview };
    }
    return { status: 'claimable', preview };
  }

  /**
   * Nhận chứng chỉ. Một lần cho mỗi khóa/lộ trình — điều đó do unique index của CSDL quyết
   * định chứ không phải lần kiểm `findActive` bên dưới: lần kiểm chỉ để trả lỗi dễ hiểu, hai
   * tab bấm cùng lúc thì index là thứ chặn.
   */
  async claim(
    user: AuthenticatedUser,
    subject: CertificateSubject,
    id: string,
    rawName: string,
  ): Promise<CertificateView> {
    const userId = requireHumanId(user);
    const recipientName = normalizeRecipientName(rawName);
    if (!recipientName) {
      throw new InvalidInput("Tên dài 2–80 ký tự, chỉ gồm chữ cái, khoảng trắng và . ' -");
    }
    if (await this.store.findActive(userId, subject, id)) {
      throw new AlreadyExists('Chứng chỉ', { reason: 'Bạn đã nhận chứng chỉ này' });
    }
    const [info, completion] = await Promise.all([
      this.mustFindSubject(subject, id),
      this.store.completion(userId, subject, id),
    ]);
    if (completion?.status !== 'completed') {
      throw new BusinessRuleViolation(
        `Hoàn thành ${subject === 'course' ? 'khóa học' : 'lộ trình'} trước khi nhận chứng chỉ`,
      );
    }

    // Trùng mã (50 bit) gần như không xảy ra, nhưng nếu có thì sinh mã khác thay vì báo lỗi.
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generateCertificateCode();
      try {
        const row = await this.store.issue({
          userId,
          subject,
          subjectId: id,
          templateId: info.templateId,
          recipientName,
          code,
          data: this.data(subject, info, completion, recipientName, code, new Date()),
          design: info.design,
        });
        return toView(row);
      } catch (cause) {
        if (!isUniqueViolation(cause)) throw cause;
        if (await this.store.findActive(userId, subject, id)) {
          throw new AlreadyExists('Chứng chỉ', { reason: 'Bạn đã nhận chứng chỉ này' });
        }
      }
    }
    throw new Error('Không sinh được mã chứng chỉ không trùng sau 3 lần');
  }

  async mine(user: AuthenticatedUser): Promise<CertificateView[]> {
    return (await this.store.listMine(requireHumanId(user))).map(toView);
  }

  /**
   * Trang xác thực công khai. Chứng chỉ đã thu hồi chỉ trả trạng thái, không trả tên: người
   * cầm mã cũ không còn được thấy thông tin của học viên.
   */
  async verify(code: string): Promise<{ status: 'valid'; certificate: CertificateView } | { status: 'revoked'; code: string; revokedAt: Date }> {
    const normalized = code.trim().toUpperCase();
    if (!CERTIFICATE_CODE.test(normalized)) throw new NotFound('Chứng chỉ', code);
    const row = await this.store.findByCode(normalized);
    if (!row) throw new NotFound('Chứng chỉ', code);
    if (row.revokedAt) return { status: 'revoked', code: row.code, revokedAt: row.revokedAt };
    return { status: 'valid', certificate: toView(row) };
  }

  async adminList(query: { q?: string; page: number; limit: number }) {
    const { items, total } = await this.store.adminList({
      q: query.q,
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
    });
    return {
      total,
      items: items.map((row) => ({
        ...toView(row),
        email: row.email,
        revokedAt: row.revokedAt,
        revokeReason: row.revokeReason,
      })),
    };
  }

  /**
   * Thu hồi để học viên nhận lại (ví dụ in sai tên). Dấu vết nằm ngay trên hàng chứng chỉ
   * (`revoked_by`, `revoke_reason`): `audit_logs` thuộc core-service, service này không ghi được.
   */
  async revoke(user: AuthenticatedUser, id: string, reason: string): Promise<void> {
    const trimmed = reason.trim();
    if (trimmed.length < 5 || trimmed.length > 500) throw new InvalidInput('Lý do dài 5–500 ký tự');
    if (!(await this.store.revoke(id, requireHumanId(user), trimmed))) {
      throw new NotFound('Chứng chỉ đang hiệu lực', id);
    }
  }

  private async mustFindSubject(subject: CertificateSubject, id: string) {
    const info = await this.store.subject(subject, id);
    if (!info) throw new NotFound(subject === 'course' ? 'Khóa học' : 'Lộ trình', id);
    return info;
  }

  private data(
    subject: CertificateSubject,
    info: { title: string; instructorName: string; durationHours: number | null },
    completion: { startedAt: Date; completedAt: Date | null } | null,
    learnerName: string,
    code: string,
    issuedAt: Date,
  ): CertificateData {
    return {
      learnerName,
      subjectKind: subject,
      subjectTitle: info.title,
      instructorName: info.instructorName,
      startedAt: completion?.startedAt.toISOString() ?? null,
      completedAt: completion?.completedAt?.toISOString() ?? null,
      durationHours: info.durationHours,
      issuedAt: issuedAt.toISOString(),
      certificateCode: code,
    };
  }
}

function isUniqueViolation(cause: unknown): boolean {
  const error = cause as { code?: string; meta?: { code?: string } };
  return error?.code === '23505' || error?.meta?.code === '23505' || error?.code === 'P2002';
}

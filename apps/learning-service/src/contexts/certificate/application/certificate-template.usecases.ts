import { Injectable } from '@nestjs/common';
import { InvalidInput, NotAuthorized, NotFound } from '@codementor/kernel';
import {
  IMAGE_CONTENT_TYPES,
  ObjectStorageService,
  canEditCourse,
  canEditRoadmap,
  requireHumanId,
  type AuthenticatedUser,
  type PresignedUpload,
} from '@codementor/platform';
import { validateDesign, type CertificateDesign } from '../domain/certificate-design';
import {
  CertificateTemplateStore,
  type CertificateSubject,
  type CertificateTemplateRow,
} from '../infrastructure/certificate-template.store';

export interface CertificateTemplateView extends Omit<CertificateTemplateRow, 'ownerId'> {
  isDefault: boolean;
  /** Người hỏi sửa được không: chủ mẫu, hoặc admin với mẫu mặc định. */
  editable: boolean;
}

export interface TemplateInput {
  name: string;
  subject: CertificateSubject | null;
  design: unknown;
}

const ASSET_PREFIX = 'certificates/templates';

@Injectable()
export class CertificateTemplateUseCases {
  constructor(
    private readonly store: CertificateTemplateStore,
    private readonly storage: ObjectStorageService,
  ) {}

  async list(user: AuthenticatedUser): Promise<CertificateTemplateView[]> {
    const rows = await this.store.list(requireHumanId(user));
    return rows.map((row) => this.view(user, row));
  }

  async get(user: AuthenticatedUser, id: string): Promise<CertificateTemplateView> {
    return this.view(user, await this.mustSee(user, id));
  }

  async create(user: AuthenticatedUser, input: TemplateInput): Promise<CertificateTemplateView> {
    const ownerId = requireHumanId(user);
    const id = await this.store.insert({ ownerId, ...this.clean(input) });
    return this.get(user, id);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: TemplateInput,
  ): Promise<CertificateTemplateView> {
    const row = await this.mustEdit(user, id);
    const clean = this.clean(input);
    // Mẫu mặc định dùng cho cả khóa học và lộ trình — thu hẹp nó là để một nửa nền tảng
    // không có mẫu nào.
    await this.store.update(row.id, { ...clean, subject: row.ownerId === null ? null : clean.subject });
    return this.get(user, id);
  }

  async archive(user: AuthenticatedUser, id: string): Promise<void> {
    const row = await this.mustEdit(user, id);
    if (row.ownerId === null) throw new InvalidInput('Không thể xóa mẫu mặc định của nền tảng');
    await this.store.archive(row.id);
  }

  async presignAsset(
    user: AuthenticatedUser,
    id: string,
    input: {
      kind: 'logo' | 'signature';
      filename: string;
      contentType: (typeof IMAGE_CONTENT_TYPES)[number];
      sizeBytes: number;
    },
  ): Promise<PresignedUpload> {
    const row = await this.mustEdit(user, id);
    const signed = await this.storage.presignImageUpload({
      prefix: `${ASSET_PREFIX}/${row.id}/${input.kind}`,
      filename: input.filename,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    });
    if (signed.isFail) throw signed.error;
    return signed.value;
  }

  /** Mẫu đang gắn; `null` = mẫu mặc định. Cùng quyền với việc gắn. */
  async attached(
    user: AuthenticatedUser,
    subject: CertificateSubject,
    subjectId: string,
  ): Promise<{ templateId: string | null }> {
    const owner = await this.mustOwnSubject(user, subject, subjectId);
    return { templateId: owner.templateId };
  }

  /** `templateId: null` = quay về mẫu mặc định của nền tảng. */
  async attach(
    user: AuthenticatedUser,
    subject: CertificateSubject,
    subjectId: string,
    templateId: string | null,
  ): Promise<{ templateId: string | null }> {
    await this.mustOwnSubject(user, subject, subjectId);
    if (templateId !== null) {
      const template = await this.mustSee(user, templateId);
      if (template.subject !== null && template.subject !== subject) {
        throw new InvalidInput(
          `Mẫu này chỉ dùng cho ${template.subject === 'course' ? 'khóa học' : 'lộ trình'}`,
        );
      }
      // Gắn mẫu mặc định = không gắn gì: để sau này admin đổi mẫu mặc định thì nó đi theo.
      if (template.ownerId === null) templateId = null;
    }
    await this.store.attach(subject, subjectId, templateId);
    return { templateId };
  }

  private clean(input: TemplateInput): {
    name: string;
    subject: CertificateSubject | null;
    design: CertificateDesign;
  } {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 80) throw new InvalidInput('Tên mẫu dài 2–80 ký tự');
    const { design, errors } = validateDesign(input.design);
    if (!design) throw new InvalidInput('Thiết kế chứng chỉ không hợp lệ', { errors });
    // Ảnh phải là thứ đã tải lên kho của mình: một URL tùy ý sẽ được nhúng vào trang xác thực
    // công khai, tức là cho phép giảng viên chèn ảnh từ bất kỳ đâu lên trang của nền tảng.
    for (const url of [design.logoUrl, design.signatureUrl]) {
      if (url && !this.storage.isImageUrlFor(url, ASSET_PREFIX)) {
        throw new InvalidInput('Ảnh logo/chữ ký phải được tải lên qua trang soạn mẫu');
      }
    }
    return { name, subject: input.subject, design };
  }

  private async mustOwnSubject(user: AuthenticatedUser, subject: CertificateSubject, subjectId: string) {
    const owner = await this.store.findOwner(subject, subjectId);
    if (!owner) throw new NotFound(subject === 'course' ? 'Khóa học' : 'Lộ trình', subjectId);
    const allowed =
      subject === 'course'
        ? canEditCourse(user, { created_by: owner.createdBy })
        : canEditRoadmap(user, { created_by: owner.createdBy });
    if (!allowed) throw new NotAuthorized('gắn mẫu chứng chỉ cho nội dung của người khác');
    return owner;
  }

  private async mustSee(user: AuthenticatedUser, id: string): Promise<CertificateTemplateRow> {
    const row = await this.store.find(id);
    if (!row || (row.ownerId !== null && row.ownerId !== user.id && user.role !== 'admin')) {
      throw new NotFound('Mẫu chứng chỉ', id);
    }
    return row;
  }

  private async mustEdit(user: AuthenticatedUser, id: string): Promise<CertificateTemplateRow> {
    const row = await this.mustSee(user, id);
    if (!this.canEdit(user, row)) throw new NotAuthorized('sửa mẫu chứng chỉ này');
    return row;
  }

  private canEdit(user: AuthenticatedUser, row: CertificateTemplateRow): boolean {
    return row.ownerId === null ? user.role === 'admin' : row.ownerId === user.id;
  }

  private view(user: AuthenticatedUser, row: CertificateTemplateRow): CertificateTemplateView {
    const { ownerId, ...rest } = row;
    return { ...rest, isDefault: ownerId === null, editable: this.canEdit(user, row) };
  }
}

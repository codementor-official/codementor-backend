import {
  BadRequestException,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '@codementor/platform';
import type { AuthenticatedUser } from '@codementor/platform';
import { KeycloakAdminService } from '../../identity/infrastructure/keycloak-admin.service';
import { MirrorAccountUseCase } from '../../identity/application/mirror-account.usecase';
import { AuditLogService } from './audit-log.service';
import type { ReportStatus } from './content-report.service';
import { rollbackBlocker, suspensionEndsAt, type SuspensionDays } from './report-rules';

/**
 * Nội dung bị báo cáo, đọc thẳng từ bảng của từng loại — cùng cách `user_bookmarks` đã làm
 * (cùng một PostgreSQL). Tài liệu nhóm dẫn về nhóm chứa nó, vì tài liệu không có trang riêng.
 */
export const REPORT_TARGET_JOINS = `
  LEFT JOIN courses c ON r.target_type = 'COURSE' AND c.id = r.target_id
  LEFT JOIN roadmaps rm ON r.target_type = 'ROADMAP' AND rm.id = r.target_id
  LEFT JOIN exercises e ON r.target_type = 'EXERCISE' AND e.id = r.target_id
  LEFT JOIN articles a ON r.target_type = 'POST' AND a.id = r.target_id
  LEFT JOIN study_groups g ON r.target_type = 'WORKSPACE' AND g.id = r.target_id
  LEFT JOIN group_documents d ON r.target_type = 'DOCUMENT' AND d.id = r.target_id
  LEFT JOIN study_groups dg ON dg.id = d.group_id
  LEFT JOIN users owner ON owner.id = CASE r.target_type
    WHEN 'COURSE' THEN COALESCE(c.instructor_id, c.created_by)
    WHEN 'ROADMAP' THEN rm.created_by
    WHEN 'EXERCISE' THEN e.author_id
    WHEN 'POST' THEN a.author_id
    WHEN 'WORKSPACE' THEN g.owner_id
    WHEN 'DOCUMENT' THEN d.uploader_id
  END`;

export const REPORT_TARGET_COLUMNS = `
  COALESCE(c.title, rm.title, e.title, a.title, g.name, d.title) AS "targetTitle",
  COALESCE(c.slug::text, rm.slug::text, e.slug::text, a.slug::text, g.slug::text, dg.slug::text) AS "targetSlug",
  CASE r.target_type
    WHEN 'COURSE' THEN c.status::text WHEN 'ROADMAP' THEN rm.status::text
    WHEN 'EXERCISE' THEN e.status::text WHEN 'POST' THEN a.status::text
    WHEN 'WORKSPACE' THEN g.status::text WHEN 'DOCUMENT' THEN d.status::text
  END AS "targetStatus",
  dg.name AS "targetParentName",
  owner.id AS "ownerId", owner.display_name AS "ownerName", owner.email AS "ownerEmail",
  owner.role::text AS "ownerRole", owner.status::text AS "ownerStatus",
  (SELECT count(*)::int FROM content_reports same
    WHERE same.target_type = r.target_type AND same.target_id = r.target_id) AS "sameTargetCount"`;

export type ReportActionKind = 'STATUS_CHANGED' | 'USER_SUSPENDED' | 'ROLLED_BACK';

export interface ReportActionRow {
  id: string;
  action: ReportActionKind;
  actorEmail: string;
  fromStatus: ReportStatus | null;
  toStatus: ReportStatus | null;
  note: string;
  sanctionedUserId: string | null;
  sanctionedUserName: string | null;
  revertsActionId: string | null;
  revertedAt: Date | null;
  /** Hạn khoá với USER_SUSPENDED; `null` là khoá tới khi có người mở. */
  suspendedUntil: Date | null;
  createdAt: Date;
}

const STATUS_LABEL: Record<ReportStatus, string> = {
  PENDING: 'Chờ xử lý',
  RESOLVED: 'Đã xử lý vi phạm',
  REJECTED: 'Không vi phạm',
};

interface LockedReport {
  id: string;
  status: ReportStatus;
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
}

@Injectable()
export class ReportModerationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReportModerationService.name);
  private expiryTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly keycloak: KeycloakAdminService,
    private readonly mirror: MirrorAccountUseCase,
    private readonly audit: AuditLogService,
  ) {}

  async detail(id: string) {
    const [report] = await this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT r.id, r.target_type AS "targetType", r.target_id AS "targetId",
              r.target_ref AS "targetRef", r.category, r.note, r.status,
              r.resolution_note AS "resolutionNote", r.resolved_at AS "resolvedAt",
              r.submitted_at AS "submittedAt", r.created_at AS "createdAt", r.updated_at AS "updatedAt",
              u.display_name AS "reporterName", u.email AS "reporterEmail",
              ${REPORT_TARGET_COLUMNS}
       FROM content_reports r
       JOIN users u ON u.id = r.reporter_id
       ${REPORT_TARGET_JOINS}
       WHERE r.id = $1::uuid`,
      id,
    );
    if (!report) throw new NotFoundException('Không tìm thấy báo cáo');
    const history = await this.history(id);
    return {
      ...report,
      actions: history.map((row) => ({ ...row, rollbackBlocker: rollbackBlocker(row, history) })),
    };
  }

  /** Đổi trạng thái theo bất kỳ chiều nào, kể cả mở lại một báo cáo đã đóng. */
  async changeStatus(
    id: string,
    actor: AuthenticatedUser,
    actorId: string,
    status: ReportStatus,
    note: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const report = await this.lock(tx, id);
      if (report.status === status)
        throw new BadRequestException(`Báo cáo đang ở trạng thái “${STATUS_LABEL[status]}”.`);
      const closing = status !== 'PENDING';
      await tx.$executeRaw`
        UPDATE content_reports
        SET status = ${status},
            resolution_note = ${closing ? note : null},
            resolved_by = ${closing ? actorId : null}::uuid,
            resolved_at = ${closing ? new Date() : null},
            updated_at = now()
        WHERE id = ${id}::uuid`;
      await this.insertAction(tx, id, actor, actorId, {
        action: 'STATUS_CHANGED',
        fromStatus: report.status,
        toStatus: status,
        note,
        previous: report,
      });
    });
    await this.audit.record(actor, {
      action: 'report.status_changed',
      targetType: 'content_report',
      targetId: id,
      summary: `Đổi trạng thái báo cáo thành “${STATUS_LABEL[status]}”`,
      metadata: { status, note },
    });
    return this.detail(id);
  }

  /** Tạm khoá tài khoản tác giả của nội dung bị báo cáo — cùng cơ chế với trang Người dùng. */
  // shortcut: quét hết hạn khoá bằng setInterval trong tiến trình, đúng với một bản core-service
  // trên EC2. Chạy nhiều bản thì chuyển sang job có khoá (advisory lock) hoặc scheduler riêng.
  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.expiryTimer = setInterval(() => void this.expireSuspensions(), 60_000);
  }

  onModuleDestroy() {
    clearInterval(this.expiryTimer);
  }

  /** Mở lại tài khoản có hạn khoá đã qua; ghi một dòng "hệ thống" vào lịch sử báo cáo. */
  async expireSuspensions(): Promise<number> {
    const due = await this.prisma.$queryRaw<
      Array<{
        id: string;
        reportId: string;
        userId: string;
        externalId: string | null;
        status: string;
      }>
    >`
      SELECT a.id, a.report_id AS "reportId", u.id AS "userId", u.external_id AS "externalId",
             u.status::text AS status
      FROM content_report_actions a
      JOIN users u ON u.id = a.sanctioned_user_id
      WHERE a.action = 'USER_SUSPENDED' AND a.reverted_at IS NULL
        AND a.suspended_until IS NOT NULL AND a.suspended_until <= now()`;
    for (const row of due) {
      try {
        if (row.externalId && row.status === 'suspended') {
          await this.keycloak.setEnabled(row.externalId, true);
          await this.mirror.status(row.externalId, true);
        }
        await this.prisma.$transaction([
          this.prisma
            .$executeRaw`UPDATE content_report_actions SET reverted_at = now() WHERE id = ${row.id}::uuid AND reverted_at IS NULL`,
          this.prisma.$executeRaw`
            INSERT INTO content_report_actions
              (report_id, actor_email, action, note, sanctioned_user_id, reverts_action_id)
            VALUES (${row.reportId}::uuid, 'Hệ thống', 'ROLLED_BACK', 'Hết thời hạn khoá, tự mở lại tài khoản.',
                    ${row.userId}::uuid, ${row.id}::uuid)`,
        ]);
      } catch (error) {
        // Lỗi một tài khoản không chặn các tài khoản khác; phút sau quét lại.
        this.logger.error(`không mở khoá được tài khoản ${row.userId} khi hết hạn`, error as Error);
      }
    }
    return due.length;
  }

  async suspendOwner(
    id: string,
    actor: AuthenticatedUser,
    actorId: string,
    note: string,
    days: SuspensionDays | null,
  ) {
    const [owner] = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string | null;
        externalId: string | null;
        role: string | null;
        status: string | null;
        name: string | null;
      }>
    >(
      `SELECT owner.id, owner.external_id AS "externalId", owner.role::text AS role,
              owner.status::text AS status, owner.display_name AS name
       FROM content_reports r ${REPORT_TARGET_JOINS}
       WHERE r.id = $1::uuid`,
      id,
    );
    if (!owner) throw new NotFoundException('Không tìm thấy báo cáo');
    if (!owner.id || !owner.externalId)
      throw new BadRequestException('Không xác định được tác giả của nội dung này.');
    if (owner.id === actorId)
      throw new BadRequestException('Không thể tự khoá tài khoản của mình.');
    if (owner.role === 'admin')
      throw new BadRequestException('Không khoá tài khoản quản trị viên từ báo cáo vi phạm.');
    if (owner.status !== 'active')
      throw new ConflictException('Tài khoản tác giả không ở trạng thái hoạt động.');

    const until = suspensionEndsAt(days, new Date());
    // Keycloak trước, DB sau: khoá hỏng thì không để lại dòng lịch sử nói rằng đã khoá.
    await this.keycloak.setEnabled(owner.externalId, false);
    await this.mirror.status(owner.externalId, false);
    await this.prisma.$transaction(async (tx) => {
      const report = await this.lock(tx, id);
      await this.insertAction(tx, id, actor, actorId, {
        action: 'USER_SUSPENDED',
        fromStatus: report.status,
        toStatus: report.status,
        note,
        previous: report,
        sanctionedUserId: owner.id,
        suspendedUntil: until,
      });
    });
    await this.audit.record(actor, {
      action: 'user.suspended',
      targetType: 'user',
      targetId: owner.id,
      summary: `Tạm khoá tài khoản ${owner.name ?? ''} theo báo cáo vi phạm${until ? ` tới ${until.toISOString()}` : ' (không thời hạn)'}`,
      metadata: {
        reportId: id,
        note,
        keycloakId: owner.externalId,
        suspendedUntil: until?.toISOString() ?? null,
      },
    });
    return this.detail(id);
  }

  async rollback(
    id: string,
    actionId: string,
    actor: AuthenticatedUser,
    actorId: string,
    note: string,
  ) {
    const history = await this.history(id);
    const target = history.find((row) => row.id === actionId);
    if (!target) throw new NotFoundException('Không tìm thấy thao tác trong lịch sử báo cáo này.');
    const blocker = rollbackBlocker(target, history);
    if (blocker) throw new ConflictException(blocker);

    if (target.action === 'USER_SUSPENDED') {
      const [user] = await this.prisma.$queryRaw<Array<{ externalId: string; status: string }>>`
        SELECT external_id AS "externalId", status::text AS status FROM users WHERE id = ${target.sanctionedUserId}::uuid`;
      // Đã có người mở khoá ở trang Người dùng thì chỉ đánh dấu đã hoàn tác, không gọi lại Keycloak.
      if (user?.externalId && user.status === 'suspended') {
        await this.keycloak.setEnabled(user.externalId, true);
        await this.mirror.status(user.externalId, true);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const report = await this.lock(tx, id);
      const [fresh] = await tx.$queryRaw<
        Array<{
          revertedAt: Date | null;
          previousNote: string | null;
          previousResolvedBy: string | null;
          previousResolvedAt: Date | null;
        }>
      >`
        SELECT reverted_at AS "revertedAt", previous_note AS "previousNote",
               previous_resolved_by AS "previousResolvedBy", previous_resolved_at AS "previousResolvedAt"
        FROM content_report_actions WHERE id = ${actionId}::uuid FOR UPDATE`;
      if (fresh?.revertedAt) throw new ConflictException('Thao tác này vừa được hoàn tác.');
      if (target.action === 'STATUS_CHANGED') {
        if (report.status !== target.toStatus)
          throw new ConflictException('Trạng thái báo cáo đã đổi sau thao tác này.');
        await tx.$executeRaw`
          UPDATE content_reports
          SET status = ${target.fromStatus}, resolution_note = ${fresh.previousNote},
              resolved_by = ${fresh.previousResolvedBy}::uuid, resolved_at = ${fresh.previousResolvedAt},
              updated_at = now()
          WHERE id = ${id}::uuid`;
      }
      await tx.$executeRaw`UPDATE content_report_actions SET reverted_at = now() WHERE id = ${actionId}::uuid`;
      await this.insertAction(tx, id, actor, actorId, {
        action: 'ROLLED_BACK',
        fromStatus: report.status,
        toStatus: target.action === 'STATUS_CHANGED' ? target.fromStatus : report.status,
        note,
        previous: report,
        revertsActionId: actionId,
        sanctionedUserId: target.sanctionedUserId,
      });
    });
    await this.audit.record(actor, {
      action: 'report.action_reverted',
      targetType: 'content_report',
      targetId: id,
      summary:
        target.action === 'USER_SUSPENDED'
          ? 'Hoàn tác khoá tài khoản theo báo cáo'
          : 'Hoàn tác đổi trạng thái báo cáo',
      metadata: { actionId, note },
    });
    return this.detail(id);
  }

  private async history(id: string): Promise<ReportActionRow[]> {
    return this.prisma.$queryRaw<ReportActionRow[]>`
      SELECT a.id, a.action, a.actor_email AS "actorEmail", a.from_status AS "fromStatus",
             a.to_status AS "toStatus", a.note, a.sanctioned_user_id AS "sanctionedUserId",
             s.display_name AS "sanctionedUserName", a.reverts_action_id AS "revertsActionId",
             a.reverted_at AS "revertedAt", a.suspended_until AS "suspendedUntil", a.created_at AS "createdAt"
      FROM content_report_actions a
      LEFT JOIN users s ON s.id = a.sanctioned_user_id
      WHERE a.report_id = ${id}::uuid
      ORDER BY a.created_at DESC, a.id DESC`;
  }

  private async lock(tx: Prisma.TransactionClient, id: string): Promise<LockedReport> {
    const [report] = await tx.$queryRaw<LockedReport[]>`
      SELECT id, status, resolution_note AS "resolutionNote", resolved_by AS "resolvedBy",
             resolved_at AS "resolvedAt"
      FROM content_reports WHERE id = ${id}::uuid FOR UPDATE`;
    if (!report) throw new NotFoundException('Không tìm thấy báo cáo');
    return report;
  }

  private async insertAction(
    tx: Prisma.TransactionClient,
    reportId: string,
    actor: AuthenticatedUser,
    actorId: string,
    input: {
      action: ReportActionKind;
      fromStatus: ReportStatus | null;
      toStatus: ReportStatus | null;
      note: string;
      previous: LockedReport;
      sanctionedUserId?: string | null;
      revertsActionId?: string;
      suspendedUntil?: Date | null;
    },
  ) {
    await tx.$executeRaw`
      INSERT INTO content_report_actions
        (report_id, actor_id, actor_email, action, from_status, to_status, previous_note,
         previous_resolved_by, previous_resolved_at, note, sanctioned_user_id, reverts_action_id,
         suspended_until)
      VALUES (${reportId}::uuid, ${actorId}::uuid, ${actor.email ?? actor.externalId}, ${input.action},
              ${input.fromStatus}, ${input.toStatus}, ${input.previous.resolutionNote},
              ${input.previous.resolvedBy}::uuid, ${input.previous.resolvedAt}, ${input.note},
              ${input.sanctionedUserId ?? null}::uuid, ${input.revertsActionId ?? null}::uuid,
              ${input.suspendedUntil ?? null})`;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@codementor/platform';
import type { AuthenticatedUser } from '@codementor/platform';

export interface AuditEntry {
  /** Động từ nghiệp vụ quá khứ, chấm phân cấp: `user.role_changed`. */
  action: string;
  targetType: string;
  targetId: string;
  /** Câu quản trị viên đọc được, không phải mã lỗi. */
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface AuditLogRow {
  id: string;
  actorId: string | null;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/**
 * Ghi và đọc nhật ký kiểm toán.
 *
 * `record` KHÔNG bao giờ ném lỗi ra ngoài. Ghi nhật ký là việc phụ của một thao tác quản
 * trị: nếu bảng nhật ký hỏng mà làm hỏng luôn lệnh khoá tài khoản, thì lúc sự cố xảy ra
 * quản trị viên vừa không khoá được tài khoản vừa không hiểu tại sao. Lỗi đi vào log ứng
 * dụng thay vì đi ngược lên người dùng.
 *
 * Đổi lại, có trường hợp thao tác thành công mà không có dòng nhật ký nào. Đó là đánh đổi
 * có chủ ý và nó đúng chiều: mất một dòng ghi chép còn hơn mất khả năng thao tác.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(actor: AuthenticatedUser, entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        INSERT INTO audit_logs (actor_id, actor_email, action, target_type, target_id, summary, metadata)
        VALUES (
          (SELECT id FROM users WHERE external_id = ${actor.externalId} LIMIT 1),
          ${actor.email ?? actor.externalId},
          ${entry.action},
          ${entry.targetType},
          ${entry.targetId},
          ${entry.summary},
          ${JSON.stringify(entry.metadata ?? {})}::jsonb
        )`;
    } catch (error) {
      this.logger.error(`không ghi được nhật ký cho ${entry.action}`, error as Error);
    }
  }

  /**
   * Đọc nhật ký, mới nhất trước.
   *
   * Lọc theo đối tượng là đường dùng nhiều nhất (drawer chi tiết tài khoản), và nó khớp
   * đúng chỉ mục `(target_type, target_id, created_at DESC)`.
   */
  async list(filter: {
    targetType?: string;
    targetId?: string;
    action?: string;
    limit?: number;
  }): Promise<AuditLogRow[]> {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const rows = await this.prisma.$queryRaw<(Omit<AuditLogRow, 'createdAt'> & { createdAt: Date })[]>`
      SELECT id, actor_id AS "actorId", actor_email AS "actorEmail", action,
             target_type AS "targetType", target_id AS "targetId", summary, metadata,
             created_at AS "createdAt"
      FROM audit_logs
      WHERE (${filter.targetType ?? null}::text IS NULL OR target_type = ${filter.targetType ?? null})
        AND (${filter.targetId ?? null}::text IS NULL OR target_id = ${filter.targetId ?? null})
        AND (${filter.action ?? null}::text IS NULL OR action = ${filter.action ?? null})
      ORDER BY created_at DESC
      LIMIT ${limit}`;

    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }
}

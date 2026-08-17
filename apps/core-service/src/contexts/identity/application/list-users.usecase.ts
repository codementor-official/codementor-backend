import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@codementor/platform';
import {
  DEFAULT_PAGE_LIMIT,
  decodeCursor,
  toPage,
  type Page,
} from '@codementor/platform';

/**
 * Một dòng trong danh sách quản trị tài khoản.
 *
 * `externalId` là `sub` của Keycloak — đúng cái ánh xạ mà màn quản trị cần để đối chiếu
 * một tài khoản CodeMentor với tài khoản Keycloak tương ứng.
 */
export interface AdminUserRow {
  id: string;
  externalId: string | null;
  email: string;
  handle: string | null;
  displayName: string;
  avatarUrl: string | null;
  role: string;
  status: string;
  lastActiveAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListUsersQuery {
  cursor?: string;
  limit?: number;
  q?: string;
  role?: string;
  status?: string;
}

/**
 * Danh sách tài khoản, đọc từ bảng `users` chứ không phải Keycloak Admin API.
 *
 * Bản cũ gọi `GET /users?max=100` rồi với MỖI người lại gọi thêm một lượt
 * `/role-mappings/realm` — 101 request HTTP cho một trang danh sách, và vẫn thiếu
 * handle, avatar, ngày tạo, lần hoạt động cuối vì Keycloak không giữ những thứ đó.
 *
 * Bảng `users` giữ đủ, lọc và phân trang được bằng SQL, và là thứ mọi service khác đã
 * coi là hồ sơ người dùng. Keycloak vẫn là nguồn sự thật cho DANH TÍNH và mật khẩu —
 * mọi thao tác đổi vai trò/khoá tài khoản vẫn đi thẳng vào Keycloak, không ghi ở đây.
 *
 * Hệ quả cần biết: hàng trong `users` được tạo lúc token đầu tiên đi qua
 * (just-in-time provisioning ở `ProvisionUserUseCase`). Một tài khoản Keycloak được tạo
 * tay mà chưa từng đăng nhập sẽ chưa xuất hiện — đó là thiết kế sẵn có, không phải lỗi
 * đồng bộ.
 */
@Injectable()
export class ListUsersUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: ListUsersQuery): Promise<Page<AdminUserRow>> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_LIMIT, 1), 100);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const where: Prisma.Sql[] = [Prisma.sql`u.status <> 'deleted'`];

    if (query.q?.trim()) {
      // `citext` cho email/handle nên chúng đã không phân biệt hoa thường; display_name
      // là text thường nên phải hạ chữ tay. Một ô tìm kiếm, ba cột — người quản trị gõ
      // cái họ nhớ chứ không chọn trước là đang tìm theo cột nào.
      const term = `%${query.q.trim().toLowerCase()}%`;
      where.push(
        Prisma.sql`(lower(u.display_name) LIKE ${term} OR u.email::text ILIKE ${term} OR coalesce(u.handle::text, '') ILIKE ${term})`,
      );
    }
    if (query.role) where.push(Prisma.sql`u.role = ${query.role}::platform_role`);
    if (query.status) where.push(Prisma.sql`u.status = ${query.status}::account_status`);
    if (cursor) {
      // Sắp theo `(updated_at, id)` giảm dần, nên trang sau là "nhỏ hơn" theo đúng cặp đó.
      where.push(
        Prisma.sql`(u.updated_at, u.id) < (${cursor.updatedAt}::timestamptz, ${cursor.id}::uuid)`,
      );
    }

    const rows = await this.prisma.$queryRaw<AdminUserRow[]>`
      SELECT u.id, u.external_id AS "externalId", u.email::text AS email,
             u.handle::text AS handle, u.display_name AS "displayName",
             u.avatar_url AS "avatarUrl", u.role::text AS role, u.status::text AS status,
             u.last_active_at AS "lastActiveAt", u.created_at AS "createdAt",
             u.updated_at AS "updatedAt"
      FROM users u
      WHERE ${Prisma.join(where, ' AND ')}
      ORDER BY u.updated_at DESC, u.id DESC
      LIMIT ${limit + 1}`;

    return toPage(rows, limit);
  }

  /** Số liệu cho trang tổng quan: tổng số và phân bố theo vai trò. */
  async summary(): Promise<{ total: number; byRole: Record<string, number> }> {
    const rows = await this.prisma.$queryRaw<{ role: string; count: bigint }[]>`
      SELECT u.role::text AS role, count(*) AS count
      FROM users u WHERE u.status <> 'deleted' GROUP BY u.role`;

    const byRole: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      // `count(*)` của Postgres về tới đây là bigint; JSON.stringify sẽ nổ nếu để nguyên.
      const count = Number(row.count);
      byRole[row.role] = count;
      total += count;
    }
    return { total, byRole };
  }
}

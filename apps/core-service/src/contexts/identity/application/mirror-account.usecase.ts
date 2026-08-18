import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@codementor/platform';

/**
 * Chép vai trò và trạng thái từ Keycloak về bảng `users`.
 *
 * Vì sao cần: Keycloak sở hữu việc đăng nhập, nên khoá một tài khoản ở đó là khoá thật —
 * người dùng không vào được nữa. Nhưng MỌI màn hình trong hệ thống lại đọc `users.status`
 * ở Postgres, và cột đó trước giờ không ai cập nhật. Hệ quả: khoá xong, danh sách quản trị
 * vẫn hiện "Đang hoạt động", mãi mãi. Không có lỗi nào được ném ra, không có gì để lần —
 * chỉ là một tài khoản bị khoá trông y hệt một tài khoản bình thường.
 *
 * Đây KHÔNG phải chuyển nguồn sự thật sang Postgres. Keycloak vẫn là nơi quyết định ai
 * đăng nhập được; cột này là bản sao để đọc, đúng vai trò mà `users` vẫn giữ cho hồ sơ.
 *
 * Không ném lỗi: thao tác khoá đã thành công ở Keycloak trước khi hàm này chạy, và để một
 * lần ghi bản sao thất bại kéo theo cả lệnh khoá thì tài khoản đáng lẽ bị khoá lại vẫn mở.
 * Lệch nhau thì lần đăng nhập kế tiếp sẽ đồng bộ lại, vì provisioning đọc lại từ Keycloak.
 */
/** Tên vai trò của Keycloak sang enum `platform_role` trong Postgres. */
const PLATFORM_ROLE_OF: Record<string, string> = {
  STUDENT: 'learner',
  LECTURER: 'lecturer',
  ADMIN: 'admin',
};

@Injectable()
export class MirrorAccountUseCase {
  private readonly logger = new Logger(MirrorAccountUseCase.name);

  constructor(private readonly prisma: PrismaService) {}

  async status(externalId: string, active: boolean): Promise<void> {
    try {
      // `status <> 'deleted'`: tài khoản đã ngừng hẳn không được bật lại thành `active`
      // chỉ vì ai đó bật cờ enabled bên Keycloak.
      await this.prisma.$executeRaw`
        UPDATE users
        SET status = ${active ? 'active' : 'suspended'}::account_status
        WHERE external_id = ${externalId} AND status <> 'deleted'`;
    } catch (error) {
      this.logger.error(`không đồng bộ được trạng thái cho ${externalId}`, error as Error);
    }
  }

  /**
   * Chép vai trò vừa gán ở Keycloak về cột `users.role`.
   *
   * Đúng cùng một lý do với `status()`, và cũng đúng cùng một lỗi: đổi vai trò ở Keycloak
   * là đổi thật — token phát ra sau đó mang vai trò mới và backend phân quyền theo nó —
   * nhưng danh sách quản trị đọc `users.role` ở Postgres, nên nó hiển thị vai trò cũ mãi
   * mãi. Đổi một giảng viên thành quản trị xong, bảng vẫn ghi "Học viên".
   *
   * Keycloak và Postgres dùng hai bộ từ vựng: `STUDENT`/`LECTURER`/`ADMIN` bên kia,
   * `learner`/`lecturer`/`admin` bên này. Bảng dịch nằm ở đây chứ không rải ra chỗ gọi.
   */
  async role(externalId: string, keycloakRole: string): Promise<void> {
    const platformRole = PLATFORM_ROLE_OF[keycloakRole];
    if (platformRole === undefined) {
      this.logger.warn(`vai trò Keycloak lạ, không chép về được: ${keycloakRole}`);
      return;
    }

    try {
      await this.prisma.$executeRaw`
        UPDATE users
        SET role = ${platformRole}::platform_role
        WHERE external_id = ${externalId} AND status <> 'deleted'`;
    } catch (error) {
      this.logger.error(`không đồng bộ được vai trò cho ${externalId}`, error as Error);
    }
  }
}

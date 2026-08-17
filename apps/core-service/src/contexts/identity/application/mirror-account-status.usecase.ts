import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@codementor/platform';

/**
 * Chép trạng thái bật/tắt từ Keycloak về cột `users.status`.
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
@Injectable()
export class MirrorAccountStatusUseCase {
  private readonly logger = new Logger(MirrorAccountStatusUseCase.name);

  constructor(private readonly prisma: PrismaService) {}

  async execute(externalId: string, active: boolean): Promise<void> {
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
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma/prisma.service';

export interface ContentAuthor {
  /** `sub` của Keycloak. Null khi tài khoản chưa từng đăng nhập (chưa provisioning). */
  externalId: string | null;
  displayName: string;
}

/**
 * Tra tác giả của một nội dung để gắn vào payload sự kiện.
 *
 * Ở `libs/platform` chứ không chép vào từng service: learning-service (khoá học, lộ
 * trình, bài viết) và exercise-service đều cần đúng một câu truy vấn này, và hai bản sao
 * của cùng một câu là hai chỗ phải nhớ sửa khi bảng `users` đổi.
 *
 * Trả `externalId` chứ không phải `users.id` vì đó là thứ realtime-service dùng làm khoá
 * phòng — nó chỉ biết danh tính từ token bắt tay và không đọc bảng của service khác.
 */
@Injectable()
export class ContentAuthorLookup {
  constructor(private readonly prisma: PrismaService) {}

  async find(userId: string | null): Promise<ContentAuthor | null> {
    if (!userId) return null;
    const row = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { external_id: true, display_name: true },
    });
    if (!row) return null;
    return { externalId: row.external_id, displayName: row.display_name };
  }
}

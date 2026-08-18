import { Controller, Get, HttpCode, HttpStatus, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, requireHumanId } from '@codementor/platform';
import type { AuthenticatedUser } from '@codementor/platform';
import { NotificationQuery } from '../application/notification-query.usecase';
import type { Viewer } from '../domain/port/notification.repository';
import { ListNotificationsQueryDto } from './dto/list-notifications.dto';

/**
 * Ba mẩu danh tính, cả ba lấy từ token đã xác thực: `users.id` để tra trạng thái đã đọc,
 * `sub` Keycloak và vai trò để biết thông báo nào gửi tới người này. Không mẩu nào được
 * phép đến từ query hay body — nhận `role` do client gửi lên là mở toang hộp thư của admin.
 */
function viewerOf(user: AuthenticatedUser): Viewer {
  return { userId: requireHumanId(user), externalId: user.externalId, role: user.role };
}

/**
 * Lịch sử thông báo. WebSocket chỉ mang được thông báo phát sinh KHI người dùng đang mở
 * máy; mọi thứ khác — đăng nhập lại, F5, mất mạng rồi vào lại — đều đọc qua đây.
 *
 * `userId` luôn lấy từ token đã xác thực, không bao giờ từ query hay body: nhận userId
 * do client gửi lên nghĩa là ai cũng đọc và đánh dấu đã đọc hộ người khác được.
 */
@ApiTags('notifications')
@ApiBearerAuth('access-token')
@Controller({ path: 'notifications', version: '1' })
export class NotificationController {
  constructor(private readonly notifications: NotificationQuery) {}

  @Get()
  @ApiOperation({ summary: 'Lịch sử thông báo, mới nhất trước' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListNotificationsQueryDto) {
    return this.notifications.list(viewerOf(user), query.limit, query.before);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Số thông báo chưa đọc, dùng cho chấm đỏ trên chuông' })
  async unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return { count: await this.notifications.unreadCount(viewerOf(user)) };
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Đánh dấu một thông báo đã đọc' })
  async markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.notifications.markRead(requireHumanId(user), id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Đánh dấu tất cả đã đọc' })
  async markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return { marked: await this.notifications.markAllRead(viewerOf(user)) };
  }
}

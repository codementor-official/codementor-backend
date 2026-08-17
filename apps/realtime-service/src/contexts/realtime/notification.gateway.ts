import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { NotificationCreatedV1 } from '@codementor/contracts';
import { HandshakeAuthService } from './handshake-auth.service';

/**
 * Phòng chung cho mọi người đã đăng nhập.
 *
 * Giai đoạn này mọi thông báo đều `audienceType: ALL` nên một phòng là đủ. Khi có
 * thông báo riêng theo người/theo nhóm thì thêm `socket.join('user:' + id)` ngay tại
 * `handleConnection` — chỗ duy nhất biết danh tính đã xác thực.
 */
const GLOBAL_ROOM = 'global';

/** Tên sự kiện client lắng nghe. Đổi tên ở đây là breaking change với frontend. */
export const NOTIFICATION_EVENT = 'notification:new';

@WebSocketGateway({
  namespace: '/realtime',
  // Trình duyệt gửi Origin cho WebSocket, và socket.io tự kiểm CORS. Dùng lại đúng danh
  // sách origin mà HTTP đang dùng để không có hai nguồn sự thật.
  cors: { origin: true, credentials: true },
})
export class NotificationGateway implements OnGatewayConnection {
  private readonly logger = new Logger(NotificationGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly handshake: HandshakeAuthService,
    private readonly config: ConfigService,
  ) {
    // Đọc để fail-fast lúc khởi động nếu thiếu cấu hình, thay vì tới lúc có người kết nối.
    this.config.get<string>('CORS_ORIGINS');
  }

  /**
   * Token đi trong `auth.token` của handshake, KHÔNG phải query string: query string bị
   * ghi vào access log của mọi proxy trên đường đi, và access token nằm trong log là
   * access token đã lộ.
   */
  async handleConnection(socket: Socket): Promise<void> {
    const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
    const identity = await this.handshake.verify(token);

    if (identity === null) {
      // Ngắt chứ không im lặng cho qua: client phải phân biệt được "chưa có thông báo
      // nào" với "kết nối của bạn không hợp lệ" để còn đi lấy token mới.
      socket.emit('auth:error', { message: 'Phiên không hợp lệ' });
      socket.disconnect(true);
      return;
    }

    await socket.join(GLOBAL_ROOM);
    this.logger.debug(`đã kết nối: ${identity.externalId} (${identity.role})`);
  }

  /** Gọi bởi consumer Kafka khi notification-service báo có thông báo mới. */
  broadcast(notification: NotificationCreatedV1): void {
    this.server.to(GLOBAL_ROOM).emit(NOTIFICATION_EVENT, notification);
  }
}

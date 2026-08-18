import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { audienceRoom, audienceRoomsFor } from '@codementor/contracts';
import type { NotificationCreatedV1 } from '@codementor/contracts';
import { HandshakeAuthService } from './handshake-auth.service';

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

    // Ba phòng: tất cả, vai trò, và đích danh người này. Tên phòng do `audienceRoom`
    // của libs/contracts dựng — cùng hàm mà notification-service dùng để gắn nhãn cho
    // thông báo, nên không có cách nào để hai bên gọi cùng một đối tượng bằng hai tên.
    await socket.join(audienceRoomsFor(identity.externalId, identity.role));
    this.logger.debug(`đã kết nối: ${identity.externalId} (${identity.role})`);
  }

  /**
   * Gọi bởi consumer Kafka khi notification-service báo có thông báo mới.
   *
   * Đẩy vào ĐÚNG một phòng, phòng do chính thông báo chỉ định. Đẩy ra phòng chung rồi
   * để client tự lọc sẽ gửi nội dung của admin xuống máy mọi người học — thông báo đã
   * rời server thì không thu lại được.
   */
  broadcast(notification: NotificationCreatedV1): void {
    const room = audienceRoom(notification.audienceType, notification.audienceKey);
    this.server.to(room).emit(NOTIFICATION_EVENT, notification);
  }
}

/**
 * Ai nhận được một thông báo.
 *
 * Ba service phải đồng ý về chuyện này — notification-service lưu nó, realtime-service
 * dùng nó làm tên phòng WebSocket, và đường đọc REST lọc theo nó. Để mỗi bên tự dựng quy
 * ước riêng thì thông báo sẽ lưu đúng mà không tới được ai, hoặc tệ hơn, tới nhầm người.
 */
export type AudienceType = 'ALL' | 'ROLE' | 'USER';

/**
 * Tên phòng WebSocket cho một đối tượng nhận.
 *
 * `USER` khoá theo `sub` của Keycloak chứ không phải `users.id`: realtime-service chỉ
 * biết danh tính từ token bắt tay và không đọc bảng của service khác.
 */
export function audienceRoom(type: AudienceType, key: string | null): string {
  return type === 'ALL' ? 'ALL' : `${type}:${key ?? ''}`;
}

/** Mọi phòng mà một người đã xác thực thuộc về. Cùng danh sách dùng để lọc lúc đọc. */
export function audienceRoomsFor(externalId: string, role: string): string[] {
  return [audienceRoom('ALL', null), audienceRoom('ROLE', role), audienceRoom('USER', externalId)];
}

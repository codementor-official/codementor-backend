import type { Email } from '../model/email';
import type { User } from '../model/user';

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  /** Tra cứu theo `sub` của Keycloak — đường vào chính khi xác thực request. */
  findByExternalId(externalId: string): Promise<User | null>;
  findByEmail(email: Email): Promise<User | null>;
  save(user: User): Promise<void>;
  /** Ghi mốc truy cập gần nhất; tự bỏ qua nếu mốc cũ còn mới hơn `throttleSeconds`. */
  touchLastActive(id: string, throttleSeconds: number): Promise<void>;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

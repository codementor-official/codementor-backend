import { Inject, Injectable } from '@nestjs/common';
import { NotFound } from '@codementor/kernel';
import { USER_REPOSITORY, type UserRepository } from '../domain/port/user.repository';
import { toUserProfile, type UserProfile } from './user-profile';

/**
 * `AuthenticatedUser` trên request chỉ mang bốn trường mà tầng auth cần để phân quyền.
 * Màn hình hồ sơ cần cả bio, avatar, timezone… nên phải đọc lại bản ghi.
 */
@Injectable()
export class GetProfileUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async execute(userId: string): Promise<UserProfile> {
    const user = await this.users.findById(userId);
    if (user === null) throw new NotFound('Người dùng');
    return toUserProfile(user);
  }
}

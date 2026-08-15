import { Inject, Injectable } from '@nestjs/common';
import { NotFound } from '@codementor/kernel';
import { Handle } from '../domain/model/handle';
import type { ProfileEdit } from '../domain/model/user';
import { USER_REPOSITORY, type UserRepository } from '../domain/port/user.repository';
import { toUserProfile, type UserProfile } from './user-profile';

/** Vắng mặt = giữ nguyên. `null` = xoá giá trị. Khớp ngữ nghĩa PATCH. */
export interface UpdateProfileInput {
  displayName?: string;
  handle?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  websiteUrl?: string | null;
  githubHandle?: string | null;
  locale?: string;
  timezone?: string;
}

@Injectable()
export class UpdateProfileUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async execute(userId: string, input: UpdateProfileInput): Promise<UserProfile> {
    const user = await this.users.findById(userId);
    if (user === null) throw new NotFound('Người dùng');

    // Handle là value object có luật riêng; dịch chuỗi sang nó trước khi vào aggregate.
    let handle: Handle | null | undefined;
    if (input.handle !== undefined) {
      if (input.handle === null || input.handle.trim() === '') {
        handle = null;
      } else {
        const parsed = Handle.create(input.handle);
        if (parsed.isFail) throw parsed.error;
        handle = parsed.value;
      }
    }

    const edit: ProfileEdit = { ...input, handle };
    const updated = user.updateProfile(edit);
    if (updated.isFail) throw updated.error;

    // Handle trùng chỉ phát hiện được ở CSDL (unique trên citext). Repository dịch
    // SQLSTATE 23505 sang AlreadyExists, filter trả 409 — không phải 500.
    await this.users.save(user);
    return toUserProfile(user);
  }
}

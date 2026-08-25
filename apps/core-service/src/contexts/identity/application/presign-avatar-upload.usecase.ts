import { Inject, Injectable } from '@nestjs/common';
import {
  AVATAR_STORAGE,
  type AvatarStoragePort,
  type AvatarUploadRequest,
  type AvatarUploadTarget,
} from '../domain/port/avatar-storage.port';

@Injectable()
export class PresignAvatarUploadUseCase {
  constructor(@Inject(AVATAR_STORAGE) private readonly storage: AvatarStoragePort) {}

  execute(userId: string, request: AvatarUploadRequest): Promise<AvatarUploadTarget> {
    return this.storage.presign(userId, request);
  }
}

import { Injectable } from '@nestjs/common';
import { ObjectStorageService } from '@codementor/platform';
import type {
  AvatarStoragePort,
  AvatarUploadRequest,
  AvatarUploadTarget,
} from '../domain/port/avatar-storage.port';

@Injectable()
export class ObjectAvatarStorageAdapter implements AvatarStoragePort {
  constructor(private readonly storage: ObjectStorageService) {}

  async presign(userId: string, request: AvatarUploadRequest): Promise<AvatarUploadTarget> {
    const result = await this.storage.presignImageUpload({
      prefix: `users/${userId}/avatar`,
      ...request,
    });
    if (result.isFail) throw result.error;
    return result.value;
  }
}

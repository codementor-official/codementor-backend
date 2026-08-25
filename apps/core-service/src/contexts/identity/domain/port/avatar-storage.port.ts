export interface AvatarUploadRequest {
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export interface AvatarUploadTarget {
  uploadUrl: string;
  headers: Record<string, string>;
  publicUrl: string;
  objectKey: string;
  expiresInSeconds: number;
}

export interface AvatarStoragePort {
  presign(userId: string, request: AvatarUploadRequest): Promise<AvatarUploadTarget>;
}

export const AVATAR_STORAGE = Symbol('AVATAR_STORAGE');

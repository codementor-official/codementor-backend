import type { ConfigService } from '@nestjs/config';
import { ObjectStorageService } from './object-storage.service';

const storage = (env: Record<string, string>) =>
  new ObjectStorageService({ get: (key: string) => env[key] } as unknown as ConfigService);

describe('ObjectStorageService.isImageUrlFor', () => {
  const s3 = storage({ AWS_S3_BUCKET: 'cm', AWS_S3_PUBLIC_URL: 'https://cdn.example.com/' });

  it('accepts what presignImageUpload returns, image prefix included', () => {
    expect(s3.isImageUrlFor('https://cdn.example.com/public/images/certificates/templates/t1/logo/a.png', 'certificates/templates')).toBe(true);
  });

  it('rejects the prefix without the image root, other folders and foreign hosts', () => {
    expect(s3.isImageUrlFor('https://cdn.example.com/certificates/templates/t1/logo/a.png', 'certificates/templates')).toBe(false);
    expect(s3.isImageUrlFor('https://cdn.example.com/public/images/courses/a.png', 'certificates/templates')).toBe(false);
    expect(s3.isImageUrlFor('https://evil.example.com/public/images/certificates/templates/a.png', 'certificates/templates')).toBe(false);
    expect(s3.isImageUrlFor('https://cdn.example.com/public/images/certificates/templates/../x.png', 'certificates/templates')).toBe(false);
  });

  it('follows AWS_S3_IMAGE_PREFIX', () => {
    const custom = storage({ AWS_S3_BUCKET: 'cm', AWS_S3_PUBLIC_URL: 'https://cdn.example.com', AWS_S3_IMAGE_PREFIX: '/img/' });
    expect(custom.isImageUrlFor('https://cdn.example.com/img/certificates/templates/a.png', 'certificates/templates')).toBe(true);
  });
});

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { BusinessRuleViolation, InvalidInput, Result } from '@codementor/kernel';

export interface PresignedUpload {
  /** Đích của lệnh `PUT`. Có hạn dùng — xem `EXPIRES_SECONDS`. */
  uploadUrl: string;
  /** Header bắt buộc phải gửi kèm, nếu không chữ ký không khớp. */
  headers: Record<string, string>;
  /** Đường dẫn đọc lại về sau. Đây là thứ được lưu vào nội dung bài học. */
  publicUrl: string;
  objectKey: string;
  expiresInSeconds: number;
}

/**
 * Chỉ nhận đúng những định dạng trình duyệt phát được bằng thẻ `<video>`. Danh sách này
 * là hợp đồng với `looksPlayable` bên frontend: nhận một định dạng ở đây mà trình duyệt
 * không phát được nghĩa là giảng viên tải lên thành công một bài học không xem được.
 */
export const VIDEO_CONTENT_TYPES = [
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
] as const;

export const DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/javascript',
  'text/css',
  'text/html',
  'application/json',
  'image/png',
  'image/jpeg',
  'image/webp',
  'video/mp4',
  'video/webm',
] as const;

export const IMAGE_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/**
 * Kho đối tượng tương thích S3, cho những thứ quá lớn để nằm trong CSDL.
 *
 * **Tải lên đi thẳng từ trình duyệt tới kho, không đi qua service này.** Service chỉ ký
 * một URL rồi trả về. Đó là lý do nó không cần `@fastify/multipart`, không giữ vài trăm
 * MB trong RAM, và không đụng tới giới hạn kích thước body của Kong — ba thứ mà đường
 * proxy sẽ phải xử lý và sẽ hỏng đúng vào lúc có người tải một video dài.
 *
 * Đánh đổi: bucket phải cho phép CORS `PUT` từ origin của studio. Đó là một dòng cấu hình
 * một lần, đổi lấy việc không có video nào chạy qua Node.
 *
 * **Chưa cấu hình thì service này vẫn khởi động được.** `isConfigured` trả `false` và mọi
 * lời gọi ký trả `Result` thất bại. Ném lỗi lúc khởi tạo sẽ khiến learning-service không
 * chạy nổi trên một máy chưa có khoá S3, dù phần lớn màn hình chẳng liên quan gì tới video.
 */
@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string | undefined;
  private readonly publicBaseUrl: string | undefined;
  /** Thư mục gốc của video trong bucket, đã cắt gạch thừa hai đầu. */
  private readonly videoPrefix: string;
  private readonly documentPrefix: string;
  private readonly imagePrefix: string;
  private readonly expiresInSeconds: number;
  readonly maxUploadBytes: number;
  readonly maxDocumentUploadBytes: number;
  readonly maxImageUploadBytes: number;

  constructor(private readonly config: ConfigService) {
    this.bucket = config.get<string>('AWS_S3_BUCKET');
    this.publicBaseUrl = config.get<string>('AWS_S3_PUBLIC_URL');
    this.videoPrefix = (config.get<string>('AWS_S3_VIDEO_PREFIX') ?? 'public/videos').replace(
      /^\/+|\/+$/g,
      '',
    );
    this.documentPrefix = (
      config.get<string>('AWS_S3_DOCUMENT_PREFIX') ?? 'public/workspace-documents'
    ).replace(/^\/+|\/+$/g, '');
    this.imagePrefix = (config.get<string>('AWS_S3_IMAGE_PREFIX') ?? 'public/images').replace(
      /^\/+|\/+$/g,
      '',
    );
    this.expiresInSeconds = config.get<number>('AWS_S3_PRESIGNED_EXPIRES') ?? 900;
    this.maxUploadBytes = (config.get<number>('VIDEO_MAX_UPLOAD_MB') ?? 500) * 1024 * 1024;
    this.maxDocumentUploadBytes =
      (config.get<number>('DOCUMENT_MAX_UPLOAD_MB') ?? 20) * 1024 * 1024;
    this.maxImageUploadBytes = (config.get<number>('IMAGE_MAX_UPLOAD_MB') ?? 5) * 1024 * 1024;

    if (!this.bucket) {
      this.client = null;
      this.logger.log('Chưa cấu hình S3 — tính năng tải tệp trực tiếp sẽ tắt');
      return;
    }

    this.client = new S3Client({
      region: config.get<string>('AWS_REGION') ?? 'ap-southeast-1',
      endpoint: config.get<string>('AWS_S3_ENDPOINT'),
      forcePathStyle: config.get<boolean>('AWS_S3_FORCE_PATH_STYLE') ?? false,
      // AWS default credential chain: ENV locally, IAM Role on EC2/ECS.
    });
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * Ký một lệnh ghi cho đúng MỘT đối tượng.
   *
   * `prefix` do nơi gọi quyết định và phải mang bối cảnh nghiệp vụ (vd. `courses/{id}`)
   * — tên tệp gốc KHÔNG được dùng làm khoá: nó do người dùng đặt, có thể chứa `../`,
   * trùng nhau giữa hai giảng viên, và làm lộ tên tệp trên máy họ. Chỉ giữ lại phần đuôi.
   */
  async presignUpload(input: {
    prefix: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
  }): Promise<Result<PresignedUpload, BusinessRuleViolation | InvalidInput>> {
    if (this.client === null || !this.bucket) {
      return Result.fail(
        new BusinessRuleViolation(
          'Chưa cấu hình kho lưu trữ video. Dùng ô “URL video” hoặc điền S3_* trong .env.',
        ),
      );
    }

    if (!VIDEO_CONTENT_TYPES.includes(input.contentType as (typeof VIDEO_CONTENT_TYPES)[number])) {
      return Result.fail(
        new InvalidInput(
          `Định dạng ${input.contentType} không phát được trên trình duyệt. Dùng MP4, WebM, OGG hoặc MOV.`,
          { contentType: input.contentType },
        ),
      );
    }

    if (input.sizeBytes <= 0 || input.sizeBytes > this.maxUploadBytes) {
      return Result.fail(
        new InvalidInput(`Video tối đa ${Math.round(this.maxUploadBytes / 1024 / 1024)} MB`, {
          sizeBytes: input.sizeBytes,
        }),
      );
    }

    // Prefix cấu hình đứng trước prefix nghiệp vụ: mọi video nằm gọn dưới một thư mục
    // duy nhất trong bucket, nên đặt quyền đọc công khai (hoặc trỏ CDN) cho đúng nhánh đó
    // là xong, không phải liệt kê từng khoá học.
    const objectKey = [
      this.videoPrefix,
      input.prefix.replace(/^\/+|\/+$/g, ''),
      `${randomUUID()}${extensionOf(input.filename)}`,
    ]
      .filter(Boolean)
      .join('/');

    // `ContentLength` nằm trong chữ ký: thiếu nó thì một URL xin ký cho 10 MB dùng được
    // để đẩy lên 10 GB, và giới hạn kiểm ở trên chỉ còn là một lời đề nghị.
    const uploadUrl = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ContentType: input.contentType,
        ContentLength: input.sizeBytes,
      }),
      { expiresIn: this.expiresInSeconds },
    );

    return Result.ok({
      uploadUrl,
      headers: { 'Content-Type': input.contentType },
      publicUrl: this.publicUrlFor(objectKey),
      objectKey,
      expiresInSeconds: this.expiresInSeconds,
    });
  }

  async presignDocumentUpload(input: {
    prefix: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
  }): Promise<Result<PresignedUpload, BusinessRuleViolation | InvalidInput>> {
    if (this.client === null || !this.bucket)
      return Result.fail(new BusinessRuleViolation('Chưa cấu hình kho lưu trữ tài liệu.'));
    if (
      !DOCUMENT_CONTENT_TYPES.includes(input.contentType as (typeof DOCUMENT_CONTENT_TYPES)[number])
    ) {
      return Result.fail(
        new InvalidInput('Chỉ hỗ trợ PDF, Office, văn bản và ảnh.', {
          contentType: input.contentType,
        }),
      );
    }
    if (input.sizeBytes <= 0 || input.sizeBytes > this.maxDocumentUploadBytes) {
      return Result.fail(
        new InvalidInput(
          `Tài liệu tối đa ${Math.round(this.maxDocumentUploadBytes / 1024 / 1024)} MB`,
          { sizeBytes: input.sizeBytes },
        ),
      );
    }
    const objectKey = [
      this.documentPrefix,
      input.prefix.replace(/^\/+|\/+$/g, ''),
      `${randomUUID()}${extensionOf(input.filename)}`,
    ]
      .filter(Boolean)
      .join('/');
    const uploadUrl = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ContentType: input.contentType,
        ContentLength: input.sizeBytes,
      }),
      { expiresIn: this.expiresInSeconds },
    );
    return Result.ok({
      uploadUrl,
      headers: { 'Content-Type': input.contentType },
      publicUrl: this.publicUrlFor(objectKey),
      objectKey,
      expiresInSeconds: this.expiresInSeconds,
    });
  }

  async presignImageUpload(input: {
    prefix: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
  }): Promise<Result<PresignedUpload, BusinessRuleViolation | InvalidInput>> {
    if (this.client === null || !this.bucket)
      return Result.fail(new BusinessRuleViolation('Chưa cấu hình kho lưu trữ hình ảnh.'));
    if (!IMAGE_CONTENT_TYPES.includes(input.contentType as (typeof IMAGE_CONTENT_TYPES)[number])) {
      return Result.fail(new InvalidInput('Ảnh đại diện chỉ hỗ trợ PNG, JPEG hoặc WebP.'));
    }
    if (input.sizeBytes <= 0 || input.sizeBytes > this.maxImageUploadBytes) {
      return Result.fail(
        new InvalidInput(`Ảnh tối đa ${Math.round(this.maxImageUploadBytes / 1024 / 1024)} MB`),
      );
    }

    const objectKey = [
      this.imagePrefix,
      input.prefix.replace(/^\/+|\/+$/g, ''),
      `${randomUUID()}${extensionOf(input.filename)}`,
    ]
      .filter(Boolean)
      .join('/');
    const uploadUrl = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ContentType: input.contentType,
        ContentLength: input.sizeBytes,
      }),
      { expiresIn: this.expiresInSeconds },
    );
    return Result.ok({
      uploadUrl,
      headers: { 'Content-Type': input.contentType },
      publicUrl: this.publicUrlFor(objectKey),
      objectKey,
      expiresInSeconds: this.expiresInSeconds,
    });
  }

  async objectExists(objectKey: string): Promise<boolean> {
    if (this.client === null || !this.bucket) return false;
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      return true;
    } catch {
      return false;
    }
  }

  isDocumentKeyFor(objectKey: string, prefix: string): boolean {
    const expected =
      [this.documentPrefix, prefix.replace(/^\/+|\/+$/g, '')].filter(Boolean).join('/') + '/';
    return objectKey.startsWith(expected) && !objectKey.includes('..');
  }

  async deleteObject(objectKey: string): Promise<void> {
    if (this.client === null || !this.bucket) return;
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
  }

  async presignDownload(
    objectKey: string,
    filename?: string,
    dispositionType: 'attachment' | 'inline' = 'attachment',
    contentType?: string,
  ): Promise<Result<{ url: string; expiresInSeconds: number }, BusinessRuleViolation>> {
    if (this.client === null || !this.bucket)
      return Result.fail(new BusinessRuleViolation('Chưa cấu hình kho lưu trữ tài liệu.'));
    const disposition = filename
      ? `${dispositionType}; filename*=UTF-8''${encodeURIComponent(filename)}`
      : dispositionType;
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ResponseContentDisposition: disposition,
        ResponseContentType: contentType ?? contentTypeOf(objectKey),
      }),
      { expiresIn: this.expiresInSeconds },
    );
    return Result.ok({ url, expiresInSeconds: this.expiresInSeconds });
  }

  publicUrl(objectKey: string): string {
    return this.publicUrlFor(objectKey);
  }

  /**
   * Đường đọc lại đối tượng. Ưu tiên `S3_PUBLIC_BASE_URL` khi có CDN đứng trước; nếu
   * không thì dựng từ endpoint theo đúng kiểu addressing đang bật.
   */
  private publicUrlFor(objectKey: string): string {
    if (this.publicBaseUrl) return `${this.publicBaseUrl.replace(/\/+$/, '')}/${objectKey}`;

    const endpoint = this.config.get<string>('AWS_S3_ENDPOINT');
    const region = this.config.get<string>('AWS_REGION') ?? 'ap-southeast-1';
    if (!endpoint) return `https://${this.bucket}.s3.${region}.amazonaws.com/${objectKey}`;

    const base = endpoint.replace(/\/+$/, '');
    return this.config.get<boolean>('AWS_S3_FORCE_PATH_STYLE')
      ? `${base}/${this.bucket}/${objectKey}`
      : base.replace('://', `://${this.bucket}.`) + `/${objectKey}`;
  }
}

/** Chỉ phần đuôi, tối đa 5 ký tự chữ/số. Mọi thứ khác trong tên tệp gốc bị bỏ. */
function extensionOf(filename: string): string {
  const match = /\.([a-zA-Z0-9]{1,5})$/.exec(filename.trim());
  return match ? `.${match[1].toLowerCase()}` : '';
}

/** Force browsers to render previewable documents instead of treating them as octet-stream. */
function contentTypeOf(objectKey: string): string | undefined {
  const extension = objectKey.split('.').pop()?.toLowerCase();
  return extension
    ? (
        {
          pdf: 'application/pdf',
          doc: 'application/msword',
          docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          xls: 'application/vnd.ms-excel',
          xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          ppt: 'application/vnd.ms-powerpoint',
          pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          txt: 'text/plain; charset=utf-8',
          md: 'text/markdown; charset=utf-8',
          csv: 'text/csv; charset=utf-8',
          json: 'application/json',
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          webp: 'image/webp',
          mp4: 'video/mp4',
          webm: 'video/webm',
        } as Record<string, string>
      )[extension]
    : undefined;
}

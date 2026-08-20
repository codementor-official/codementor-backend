import { z } from 'zod';

/**
 * Env được validate lúc khởi động, fail-fast.
 * Thiếu biến hoặc sai kiểu thì tiến trình chết ngay thay vì lỗi mơ hồ lúc chạy.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Mỗi service một cổng riêng; chỉ biến của service đang chạy được dùng tới.
  PORT_CORE: z.coerce.number().int().positive().default(3001),
  PORT_LEARNING: z.coerce.number().int().positive().default(3002),
  PORT_EXERCISE: z.coerce.number().int().positive().default(3003),
  PORT_WORKSPACE: z.coerce.number().int().positive().default(3004),
  PORT_DOCUMENT: z.coerce.number().int().positive().default(3005),
  PORT_SUBMISSION: z.coerce.number().int().positive().default(3006),
  PORT_JUDGE: z.coerce.number().int().positive().default(3007),
  PORT_AI: z.coerce.number().int().positive().default(3008),
  PORT_REALTIME: z.coerce.number().int().positive().default(3009),
  // Nhảy qua 3010/3011: hai cổng đó là apps/lecturer và apps/admin bên frontend.
  PORT_NOTIFICATION: z.coerce.number().int().positive().default(3012),
  API_PREFIX: z.string().default('api'),

  // PostgreSQL — schema do codementor-infra sở hữu, backend chỉ đọc qua Prisma.
  DATABASE_URL: z.string().url(),

  // MongoDB — nội dung dạng document.
  MONGO_URI: z.string().min(1),
  MONGO_DB: z.string().default('codementor'),

  // Xác thực do Keycloak đảm nhiệm — backend là resource server, KHÔNG tự ký token.
  KEYCLOAK_ISSUER: z
    .string()
    .url()
    .describe('vd: http://localhost:8080/realms/codementor'),
  KEYCLOAK_AUDIENCE: z.string().default('codementor-api'),
  KEYCLOAK_URL: z.string().url(),
  KEYCLOAK_REALM: z.string().default('codementor'),
  KEYCLOAK_USER_SERVICE_CLIENT_ID: z.string().default('codementor-user-service'),
  KEYCLOAK_USER_SERVICE_CLIENT_SECRET: z.string().min(1),

  /**
   * Service khác hỏi core-service để đổi `sub` của Keycloak lấy `users.id` nội bộ —
   * chỉ core được đọc bảng `users`. Xem `RemoteIdentityProvisioning`.
   */
  CORE_SERVICE_URL: z.string().url().default('http://localhost:3001'),

  KAFKA_BROKERS: z.string().default('localhost:9092'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SWAGGER_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((v) => v.split(',').map((s) => s.trim())),

  /**
   * Kho đối tượng S3 (hoặc tương thích S3) — nơi video bài học được tải lên.
   *
   * TOÀN BỘ nhóm này là tuỳ chọn, và đó là điều kiện bắt buộc chứ không phải sự dễ dãi:
   * chưa cấu hình thì ứng dụng phải chạy bình thường và chỉ tắt riêng nút tải lên. Bắt
   * buộc ở đây nghĩa là mọi service — kể cả những service không đụng gì tới video — chết
   * lúc khởi động trên một máy chưa có khoá S3. Xem `ObjectStorageService.isConfigured`.
   *
   * Tên biến theo quy ước AWS chuẩn (`AWS_ACCESS_KEY_ID`, `AWS_REGION`…) chứ không phải
   * một bộ tên riêng: đây là những tên mà AWS CLI, SDK và mọi hướng dẫn ngoài kia dùng,
   * nên khoá copy từ bảng điều khiển AWS dán thẳng vào được mà không phải đổi tên.
   */
  AWS_REGION: z.string().default('ap-southeast-1'),
  AWS_S3_BUCKET: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  /** Thư mục gốc của video trong bucket. Khoá đối tượng = prefix này + đường của bài. */
  AWS_S3_VIDEO_PREFIX: z.string().default('public/videos'),
  /** Đường ĐỌC lại. Bỏ trống = suy từ bucket/region; điền khi có CDN đứng trước. */
  AWS_S3_PUBLIC_URL: z.string().url().optional(),
  /** Hạn của một URL ký sẵn, tính bằng giây. Đủ lâu để tải xong, đủ ngắn để không thành
   * quyền ghi vĩnh viễn nếu URL lọt ra ngoài. */
  AWS_S3_PRESIGNED_EXPIRES: z.coerce.number().int().positive().default(900),
  /** Bỏ trống = AWS S3 thật. Điền vào khi dùng MinIO, R2, Spaces… */
  AWS_S3_ENDPOINT: z.string().url().optional(),
  /** MinIO và phần lớn kho tương thích S3 cần path-style; AWS thật thì không. */
  AWS_S3_FORCE_PATH_STYLE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  /** Trần dung lượng một video, tính bằng MB. Chặn ở cả hai đầu client và server. */
  VIDEO_MAX_UPLOAD_MB: z.coerce.number().int().positive().default(500),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Cấu hình môi trường không hợp lệ:\n${issues}`);
  }
  return parsed.data;
}

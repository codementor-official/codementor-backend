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

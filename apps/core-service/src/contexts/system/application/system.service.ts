import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@codementor/platform';

/** Tên, biến môi trường chứa URL, cổng mặc định khi chạy local, và đường health của service. */
const SERVICES: [name: string, env: string, port: number, path?: string][] = [
  ['core', 'CORE_SERVICE_URL', 3001],
  ['learning', 'LEARNING_SERVICE_URL', 3002],
  ['exercise', 'EXERCISE_SERVICE_URL', 3003],
  ['workspace', 'WORKSPACE_SERVICE_URL', 3004],
  ['submission', 'SUBMISSION_SERVICE_URL', 3006],
  // judge là FastAPI, health nằm dưới tiền tố của chính nó.
  ['judge', 'JUDGE_SERVICE_URL', 3007, '/api/v1/judge/health'],
  ['ai', 'AI_SERVICE_URL', 3008],
  ['realtime', 'REALTIME_SERVICE_URL', 3009],
  ['notification', 'NOTIFICATION_SERVICE_URL', 3012],
  ['recommendation', 'RECOMMENDATION_SERVICE_URL', 3013],
];
const HEALTH_TIMEOUT_MS = 2000;

export type ServiceState = 'up' | 'degraded' | 'down';

export interface ServiceHealth {
  name: string;
  state: ServiceState;
  latencyMs: number;
  /** Database nào service đó báo là đang nối được (chỉ Nest có). */
  dependencies: Record<string, boolean>;
  /** Mô tả ngắn khi `down`: mã HTTP hoặc "không phản hồi sau 2 giây". */
  error?: string;
}

/**
 * `up` chỉ khi HTTP 2xx VÀ thân báo `ok`. Nest trả `{ status: 'degraded' }` với HTTP 200 khi
 * mất một database — tính là 200 thì trang báo xanh đúng lúc Postgres đang sập.
 */
export function classifyHealth(httpOk: boolean, body: unknown): ServiceState {
  if (!httpOk) return 'down';
  const payload = body as { status?: string; data?: { status?: string } } | null;
  const status = payload?.data?.status ?? payload?.status;
  return status === 'ok' ? 'up' : 'degraded';
}

/**
 * Trang Hoạt động hệ thống và Cài đặt của admin. Chỉ đọc: sức khoẻ từng service, hàng đợi
 * sự kiện, email; và cấu hình nền tảng mà core-service thấy.
 */
@Injectable()
export class SystemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async activity() {
    const [services, outbox, consumers, email] = await Promise.all([
      Promise.all(SERVICES.map(([name, env, port, path]) => this.ping(name, env, port, path))),
      this.outbox(),
      this.consumers(),
      this.email(),
    ]);
    return { services, outbox, consumers, email, checkedAt: new Date().toISOString() };
  }

  private async ping(name: string, env: string, port: number, path = '/api/v1/health'): Promise<ServiceHealth> {
    const base = (this.config.get<string>(env) ?? `http://localhost:${port}`).replace(/\/$/, '');
    const started = Date.now();
    try {
      const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
      const body = (await response.json().catch(() => null)) as {
        dependencies?: Record<string, boolean>;
        data?: { dependencies?: Record<string, boolean> };
      } | null;
      const state = classifyHealth(response.ok, body);
      const dependencies = body?.data?.dependencies ?? body?.dependencies ?? {};
      return {
        name,
        state,
        latencyMs: Date.now() - started,
        dependencies,
        ...(response.ok ? {} : { error: `HTTP ${response.status}` }),
      };
    } catch (error) {
      const timedOut = (error as Error).name === 'TimeoutError';
      return {
        name,
        state: 'down',
        latencyMs: Date.now() - started,
        dependencies: {},
        error: timedOut ? `không phản hồi sau ${HEALTH_TIMEOUT_MS / 1000} giây` : 'không kết nối được',
      };
    }
  }

  /**
   * Chỉ phần CHƯA đẩy lên Kafka — khớp index một phần `idx_outbox_pending`. Đếm số đã đẩy trong
   * 24 giờ thì phải quét cả bảng, và bảng này chỉ lớn lên.
   */
  private async outbox() {
    const rows = await this.prisma.$queryRaw<{ topic: string; pending: number; oldest: Date }[]>`
      SELECT topic, count(*)::int AS pending, min(created_at) AS oldest
      FROM outbox WHERE published_at IS NULL GROUP BY topic ORDER BY min(created_at)`;
    return {
      pending: rows.reduce((total, row) => total + row.pending, 0),
      oldestPendingAt: rows[0]?.oldest.toISOString() ?? null,
      byTopic: rows.map((row) => ({ topic: row.topic, pending: row.pending, oldestAt: row.oldest.toISOString() })),
    };
  }

  /**
   * Consumer nào còn chạy: số sự kiện xử lý trong 24 giờ và lần cuối. Chỉ nhìn 7 ngày gần nhất
   * (theo `idx_processed_events_time`) — consumer im quá 7 ngày sẽ không có trong danh sách.
   */
  private async consumers() {
    const rows = await this.prisma.$queryRaw<{ consumer: string; last24h: number; lastAt: Date }[]>`
      SELECT consumer,
             count(*) FILTER (WHERE processed_at >= now() - interval '24 hours')::int AS "last24h",
             max(processed_at) AS "lastAt"
      FROM processed_events WHERE processed_at >= now() - interval '7 days'
      GROUP BY consumer ORDER BY max(processed_at) DESC`;
    return rows.map((row) => ({ ...row, lastAt: row.lastAt.toISOString() }));
  }

  /** Email nhắc học. Lỗi gần nhất không kèm địa chỉ người nhận. */
  private async email() {
    const [byStatus, failures] = await Promise.all([
      this.prisma.$queryRaw<{ status: string; last24h: number; last7d: number }[]>`
        SELECT status,
               count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS "last24h",
               count(*)::int AS "last7d"
        FROM email_deliveries WHERE created_at >= now() - interval '7 days'
        GROUP BY status ORDER BY status`,
      this.prisma.$queryRaw<{ template: string; error: string | null; at: Date; attempts: number }[]>`
        SELECT template, error_message AS error, created_at AS at, attempt_count AS attempts
        FROM email_deliveries
        WHERE status = 'FAILED' AND created_at >= now() - interval '7 days'
        ORDER BY created_at DESC LIMIT 10`,
    ]);
    return {
      byStatus,
      recentFailures: failures.map((row) => ({ ...row, at: row.at.toISOString() })),
    };
  }

  /**
   * Cấu hình nền tảng mà core-service đọc được. KHÔNG bao giờ trả secret: khoá, mật khẩu và
   * chuỗi kết nối chỉ ra dạng `true/false` (đã cấu hình hay chưa).
   */
  settings() {
    const text = (key: string) => this.config.get<string>(key)?.toString().trim() || null;
    const number = (key: string, fallback: number) => Number(this.config.get(key) ?? fallback);
    const configured = (...keys: string[]) => keys.every((key) => Boolean(text(key)));
    return {
      storage: {
        region: text('AWS_REGION'),
        bucket: text('AWS_S3_BUCKET'),
        credentialsConfigured: configured('AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'),
        // Cùng mặc định với `ObjectStorageService`.
        maxUploadMb: {
          video: number('VIDEO_MAX_UPLOAD_MB', 500),
          document: number('DOCUMENT_MAX_UPLOAD_MB', 20),
          image: number('IMAGE_MAX_UPLOAD_MB', 5),
        },
      },
      email: {
        // Cùng cách đọc với notification-service: chỉ gửi khi SES_ENABLED bật.
        enabled: String(this.config.get('SES_ENABLED') ?? '').toLowerCase() === 'true',
        fromEmail: text('SES_FROM_EMAIL'),
        fromName: text('SES_FROM_NAME'),
        // Cùng mặc định với `reminder-dispatcher` / `reminder-planner`.
        reminderPollSeconds: number('REMINDER_POLL_SECONDS', 60),
        learningInactivityDays: number('LEARNING_INACTIVITY_DAYS', 3),
      },
    };
  }
}

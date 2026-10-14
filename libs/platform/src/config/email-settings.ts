/**
 * Một chỗ duy nhất đọc cấu hình email, để notification-service (nơi gửi) và core-service
 * (trang Cài đặt của Admin) không thể hiểu cùng một `.env` theo hai cách.
 *
 * Hai kênh:
 * - `ses`  — SES API như trước. Tài khoản đang ở Sandbox nên chỉ địa chỉ đã xác minh nhận
 *            được thư; mọi người nhận khác bị trả `MessageRejected`.
 * - `smtp` — máy chủ SMTP bất kỳ. Với Gmail: `SMTP_HOST=smtp.gmail.com`, cổng 465, user là
 *            địa chỉ Gmail và mật khẩu là *mật khẩu ứng dụng* (không phải mật khẩu tài khoản).
 *            Gmail ghi đè địa chỉ người gửi bằng chính tài khoản đăng nhập, nên `From` phải
 *            là địa chỉ đó (hoặc một alias đã xác minh) — vì vậy mặc định lấy `SMTP_USER`.
 *
 * Biến cũ `SES_ENABLED` / `SES_FROM_*` vẫn có nghĩa khi biến `EMAIL_*` tương ứng để trống.
 */
export type EmailProviderKind = 'ses' | 'smtp';

export interface SmtpSettings {
  host: string;
  port: number;
  /** TLS ngay khi kết nối (465). `false` = STARTTLS bắt buộc. */
  secure: boolean;
  user: string;
  /** Gmail hiển thị mật khẩu ứng dụng theo nhóm 4 ký tự có dấu cách; SMTP thì không. */
  password: string;
}

export interface EmailSettings {
  enabled: boolean;
  provider: EmailProviderKind;
  fromAddress: string;
  fromName: string;
  smtp: SmtpSettings | null;
}

type Source = Record<string, unknown>;

const text = (source: Source, key: string): string | undefined => {
  const value = source[key];
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed === '' ? undefined : trimmed;
};

const flag = (source: Source, key: string): boolean | undefined => {
  const value = source[key];
  if (typeof value === 'boolean') return value;
  const raw = text(source, key)?.toLowerCase();
  return raw === undefined ? undefined : raw === 'true';
};

/**
 * Đọc từ object env đã qua `validateEnv` (hoặc `ConfigService` bọc lại bằng `fromConfig`).
 * Không ném lỗi: kiểm tra tính đầy đủ nằm ở `emailSettingsIssues`, chạy lúc khởi động.
 */
export function emailSettings(source: Source): EmailSettings {
  const provider: EmailProviderKind = text(source, 'EMAIL_PROVIDER') === 'smtp' ? 'smtp' : 'ses';
  const enabled = flag(source, 'EMAIL_ENABLED') ?? flag(source, 'SES_ENABLED') ?? false;
  const host = text(source, 'SMTP_HOST');
  const user = text(source, 'SMTP_USER');
  const password = text(source, 'SMTP_PASSWORD')?.replace(/\s+/g, '');
  const port = Number(text(source, 'SMTP_PORT') ?? 465);
  const smtp =
    provider === 'smtp' && host && user && password
      ? { host, port, secure: flag(source, 'SMTP_SECURE') ?? port === 465, user, password }
      : null;
  return {
    enabled,
    provider,
    fromAddress:
      text(source, 'EMAIL_FROM_ADDRESS') ??
      (provider === 'smtp' ? user : undefined) ??
      text(source, 'SES_FROM_EMAIL') ??
      'noreply@codementor.cloud',
    fromName: text(source, 'EMAIL_FROM_NAME') ?? text(source, 'SES_FROM_NAME') ?? 'CodeMentor',
    smtp,
  };
}

/** Thiếu gì để gửi được. Rỗng = đủ. Chỉ bắt buộc khi kênh SMTP đang BẬT. */
export function emailSettingsIssues(source: Source): string[] {
  const settings = emailSettings(source);
  if (!settings.enabled || settings.provider !== 'smtp') return [];
  return ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD']
    .filter((key) => !text(source, key))
    .map((key) => `${key}: bắt buộc khi EMAIL_PROVIDER=smtp và email đang bật`);
}

/** Bọc `ConfigService.get` thành object để dùng chung `emailSettings`. */
export function fromConfig(get: (key: string) => unknown): Source {
  return new Proxy({}, { get: (_target, key) => (typeof key === 'string' ? get(key) : undefined) });
}

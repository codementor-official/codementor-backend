import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import { emailSettings, fromConfig, type SmtpSettings } from '@codementor/platform/config/email-settings';
import {
  EmailDeliveryError,
  type EmailProvider,
  type SendEmailInput,
} from '../domain/port/email-provider';

/** Lỗi trước khi máy chủ nhận thư: chắc chắn chưa gửi, thử lại an toàn. */
const NOT_SENT = new Set(['ECONNECTION', 'EDNS', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETLS']);
/** Đứt giữa chừng: có thể máy chủ đã nhận thư. SMTP không có khoá chống trùng, nên không gửi lại. */
const MAYBE_SENT = new Set(['ETIMEDOUT', 'ESOCKET', 'ECONNRESET']);

/**
 * Phân loại một lỗi của nodemailer theo đúng ngữ nghĩa `EmailDeliveryError` mà hàng đợi
 * nhắc nhở dùng: `retryable` = hàng đợi được thử lại; `ambiguous` = không biết thư đã đi
 * chưa, đánh dấu UNKNOWN và KHÔNG gửi lại (gửi trùng tệ hơn gửi thiếu một lần).
 */
export function classifySmtpError(error: unknown): EmailDeliveryError {
  const e = error as { code?: string; responseCode?: number };
  const responseCode = typeof e.responseCode === 'number' ? e.responseCode : undefined;
  // Sai mật khẩu ứng dụng / tài khoản bị khoá: thử lại bao nhiêu lần cũng vậy.
  if (e.code === 'EAUTH') return new EmailDeliveryError('SMTP_AUTH_FAILED', false);
  // 4xx = tạm thời (hộp thư đầy, bị giới hạn tốc độ); 5xx = máy chủ từ chối hẳn.
  if (responseCode !== undefined && responseCode >= 400 && responseCode < 500)
    return new EmailDeliveryError(`SMTP_${responseCode}`, true);
  if (responseCode !== undefined && responseCode >= 500)
    return new EmailDeliveryError(`SMTP_${responseCode}`, false);
  if (e.code === 'EENVELOPE' || e.code === 'EMESSAGE')
    return new EmailDeliveryError(`SMTP_${e.code}`, false);
  if (e.code && NOT_SENT.has(e.code)) return new EmailDeliveryError(`SMTP_${e.code}`, true);
  if (e.code && MAYBE_SENT.has(e.code)) return new EmailDeliveryError(`SMTP_${e.code}`, false, true);
  return new EmailDeliveryError('SMTP_UNKNOWN', false, true);
}

/** `"Tên" <địa chỉ>` — tên đã được env schema chặn dấu nháy và xuống dòng. */
export function formatSender(name: string, address: string): string {
  return `"${name}" <${address}>`;
}

@Injectable()
export class SmtpEmailProvider implements EmailProvider, OnModuleDestroy {
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  private transport(smtp: SmtpSettings): Transporter {
    // Một kết nối dùng lại cho cả lượt gửi. Không để nodemailer tự thử lại: hàng đợi bền
    // vững trong PostgreSQL mới là nơi quyết định thử lại, giống SES provider.
    this.transporter ??= createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      requireTLS: !smtp.secure,
      auth: { user: smtp.user, pass: smtp.password },
      pool: true,
      maxConnections: 1,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    return this.transporter;
  }

  async send(input: SendEmailInput) {
    const settings = emailSettings(fromConfig((key) => this.config.get(key)));
    if (!settings.enabled) throw new EmailDeliveryError('EMAIL_DISABLED', false);
    if (!settings.smtp) throw new EmailDeliveryError('SMTP_NOT_CONFIGURED', false);
    try {
      const info = await this.transport(settings.smtp).sendMail({
        from: formatSender(settings.fromName, settings.fromAddress),
        to: input.recipient,
        subject: input.subject,
        html: input.html,
        text: input.text,
      });
      if (!info.messageId) throw new EmailDeliveryError('MISSING_MESSAGE_ID', false, true);
      return { messageId: info.messageId };
    } catch (error) {
      if (error instanceof EmailDeliveryError) throw error;
      throw classifySmtpError(error);
    }
  }

  onModuleDestroy() {
    this.transporter?.close();
  }
}

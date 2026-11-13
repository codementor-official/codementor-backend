import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PasswordResetEmailV1 } from '@codementor/contracts';
import { emailSettings, fromConfig } from '@codementor/platform/config/email-settings';
import { EMAIL_PROVIDER, type EmailProvider } from '../domain/port/email-provider';
import type { Recipient } from '../domain/model/reminder';
import { renderEmail } from './email-template';

/**
 * Sends the reset link core-service asked for, straight away: no reminder row, no email
 * preferences (the person asked for it), and never once the link has expired.
 */
@Injectable()
export class PasswordResetEmail {
  private readonly logger = new Logger(PasswordResetEmail.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider,
  ) {}

  async send(payload: PasswordResetEmailV1): Promise<boolean> {
    if (!(Date.parse(payload.expiresAt) > Date.now())) return false;
    if (!emailSettings(fromConfig((key) => this.config.get(key))).enabled) {
      this.logger.warn('Email is disabled: password reset link not sent');
      return false;
    }
    const rendered = renderEmail(
      {
        title: 'Đặt lại mật khẩu CodeMentor',
        message:
          'Có yêu cầu đặt lại mật khẩu cho tài khoản CodeMentor dùng email này. Liên kết dùng được một lần và hết hạn sau 30 phút.\n' +
          'Nếu bạn không yêu cầu, hãy bỏ qua email này: mật khẩu hiện tại vẫn giữ nguyên.',
        actionUrl: `/reset-password?token=${encodeURIComponent(payload.token)}`,
        actionLabel: 'Đặt mật khẩu mới',
      },
      { display_name: payload.displayName, timezone: 'Asia/Ho_Chi_Minh' } as Recipient,
      this.config.get<string>('CLIENT_APP_URL', 'http://localhost:3000'),
    );
    await this.provider.send({ recipient: payload.email, ...rendered });
    return true;
  }
}

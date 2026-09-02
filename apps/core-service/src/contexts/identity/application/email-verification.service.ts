import { ConflictException, HttpException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { NotFound } from '@codementor/kernel';
import { EMAIL_VERIFICATION_PROVIDER, type EmailVerificationProvider } from '../domain/port/email-verification.provider';
import { USER_REPOSITORY, type UserRepository } from '../domain/port/user.repository';

@Injectable()
export class EmailVerificationService {
  // Per-user resend guard for this service instance. Never accept a recipient from the client.
  private readonly cooldowns = new Map<string, number>();
  private readonly cooldownMs = 60_000;

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(EMAIL_VERIFICATION_PROVIDER) private readonly provider: EmailVerificationProvider,
  ) {}

  async status(userId: string) {
    const { state } = await this.readAndSync(userId);
    return { ...state, retryAfterSeconds: this.retryAfter(userId) };
  }

  async send(userId: string) {
    for (const [id, until] of this.cooldowns) {
      if (until <= Date.now()) this.cooldowns.delete(id);
    }
    const retryAfterSeconds = this.retryAfter(userId);
    if (retryAfterSeconds) {
      throw new HttpException({ message: 'Vui lòng đợi trước khi gửi lại email xác thực.', retryAfterSeconds }, 429);
    }
    // Reserve before awaiting any I/O so concurrent clicks cannot send duplicate emails.
    this.cooldowns.set(userId, Date.now() + this.cooldownMs);
    // Keep the short cooldown after failures, including ambiguous provider timeouts.
    const { user, state } = await this.readAndSync(userId);
    if (state.verified) {
      this.cooldowns.delete(userId);
      return { ...state, sent: false, retryAfterSeconds: 0 };
    }
    if (!state.canSend) {
      throw new ServiceUnavailableException('Dịch vụ gửi email xác thực chưa được cấu hình. Vui lòng liên hệ quản trị viên.');
    }
    await this.provider.sendVerificationEmail(user.externalId);
    return { ...state, sent: true, retryAfterSeconds: this.retryAfter(userId) };
  }

  private retryAfter(userId: string): number {
    return Math.max(0, Math.ceil(((this.cooldowns.get(userId) ?? 0) - Date.now()) / 1000));
  }

  private async readAndSync(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFound('Người dùng');
    const access = user.canAccessPlatform();
    if (access.isFail) throw access.error;
    const state = await this.provider.emailStatus(user.externalId);
    if (state.email.trim().toLowerCase() !== user.email.value.toLowerCase()) {
      throw new ConflictException('Email trên Keycloak đã thay đổi. Vui lòng đăng nhập lại để đồng bộ tài khoản.');
    }
    if (user.syncEmailVerification(state.verified)) await this.users.save(user);
    return { user, state };
  }
}

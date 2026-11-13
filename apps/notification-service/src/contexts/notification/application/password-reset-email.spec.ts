import { ConfigService } from '@nestjs/config';
import { PasswordResetEmail } from './password-reset-email';

const config = new ConfigService({ EMAIL_ENABLED: 'true', EMAIL_PROVIDER: 'smtp', CLIENT_APP_URL: 'https://www.codementor.cloud' });
const payload = (minutes: number) => ({
  email: 'owner@example.test', displayName: 'Owner', token: 'aaa.1800000000000.sig/+',
  expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
});

describe('Password reset email', () => {
  it('emails a link to the client reset page', async () => {
    const provider = { send: jest.fn().mockResolvedValue({ messageId: 'm' }) };
    await expect(new PasswordResetEmail(config, provider).send(payload(30))).resolves.toBe(true);
    const sent = provider.send.mock.calls[0][0];
    expect(sent.recipient).toBe('owner@example.test');
    expect(sent.subject).toBe('Đặt lại mật khẩu CodeMentor');
    expect(sent.text).toContain('https://www.codementor.cloud/reset-password?token=aaa.1800000000000.sig%2F%2B');
  });
  it('never sends an expired link', async () => {
    const provider = { send: jest.fn() };
    await expect(new PasswordResetEmail(config, provider).send(payload(-1))).resolves.toBe(false);
    expect(provider.send).not.toHaveBeenCalled();
  });
});

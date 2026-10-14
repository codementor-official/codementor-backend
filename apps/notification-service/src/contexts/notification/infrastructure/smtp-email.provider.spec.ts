import { ConfigService } from '@nestjs/config';
import { EmailDeliveryError } from '../domain/port/email-provider';
import { SmtpEmailProvider, classifySmtpError, formatSender } from './smtp-email.provider';

describe('classifySmtpError', () => {
  const classify = (error: object) => {
    const e = classifySmtpError(error);
    return { code: e.code, retryable: e.retryable, ambiguous: e.ambiguous };
  };

  it('never retries a rejected login (wrong app password, revoked access)', () => {
    expect(classify({ code: 'EAUTH', responseCode: 535 })).toEqual({
      code: 'SMTP_AUTH_FAILED',
      retryable: false,
      ambiguous: false,
    });
  });

  it('retries temporary 4xx answers and connection failures before the message is sent', () => {
    expect(classify({ responseCode: 421 })).toEqual({ code: 'SMTP_421', retryable: true, ambiguous: false });
    expect(classify({ code: 'ECONNECTION' })).toEqual({
      code: 'SMTP_ECONNECTION',
      retryable: true,
      ambiguous: false,
    });
  });

  it('gives up on permanent 5xx rejections and bad envelopes', () => {
    expect(classify({ code: 'EENVELOPE', responseCode: 550 })).toEqual({
      code: 'SMTP_550',
      retryable: false,
      ambiguous: false,
    });
    expect(classify({ code: 'EENVELOPE' }).retryable).toBe(false);
  });

  it('marks a mid-transfer drop as ambiguous so the queue does not send twice', () => {
    expect(classify({ code: 'ETIMEDOUT' })).toEqual({
      code: 'SMTP_ETIMEDOUT',
      retryable: false,
      ambiguous: true,
    });
    expect(classify({})).toEqual({ code: 'SMTP_UNKNOWN', retryable: false, ambiguous: true });
  });
});

describe('SmtpEmailProvider', () => {
  const input = { recipient: 'learner@example.test', subject: 's', html: '<p>h</p>', text: 't' };

  it('formats the sender with its display name', () => {
    expect(formatSender('CodeMentor', 'someone@gmail.com')).toBe('"CodeMentor" <someone@gmail.com>');
  });

  it('refuses to send while email is disabled, without opening a connection', async () => {
    const provider = new SmtpEmailProvider(new ConfigService({ EMAIL_PROVIDER: 'smtp', EMAIL_ENABLED: 'false' }));
    await expect(provider.send(input)).rejects.toMatchObject({ code: 'EMAIL_DISABLED', retryable: false });
  });

  it('reports missing credentials as a non-retryable configuration error', async () => {
    const provider = new SmtpEmailProvider(
      new ConfigService({ EMAIL_PROVIDER: 'smtp', EMAIL_ENABLED: 'true', SMTP_HOST: 'smtp.gmail.com' }),
    );
    const error = await provider.send(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect(error).toMatchObject({ code: 'SMTP_NOT_CONFIGURED', retryable: false });
  });
});

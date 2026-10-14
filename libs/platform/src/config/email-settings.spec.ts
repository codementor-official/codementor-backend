import { emailSettings, emailSettingsIssues, fromConfig } from './email-settings';
import { validateEnv } from './env.schema';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  MONGO_URI: 'mongodb://localhost:27017/db',
  KEYCLOAK_ISSUER: 'https://id.example.test/realms/x',
  KEYCLOAK_URL: 'https://id.example.test',
  KEYCLOAK_USER_SERVICE_CLIENT_SECRET: 'secret',
};

describe('emailSettings', () => {
  it('keeps the old SES behaviour when no EMAIL_* variable is set', () => {
    const settings = emailSettings({ SES_ENABLED: true, SES_FROM_EMAIL: 'noreply@codementor.cloud' });
    expect(settings).toMatchObject({
      enabled: true,
      provider: 'ses',
      fromAddress: 'noreply@codementor.cloud',
      fromName: 'CodeMentor',
      smtp: null,
    });
  });

  it('lets EMAIL_ENABLED override SES_ENABLED in both directions', () => {
    expect(emailSettings({ SES_ENABLED: true, EMAIL_ENABLED: 'false' }).enabled).toBe(false);
    expect(emailSettings({ SES_ENABLED: false, EMAIL_ENABLED: 'true' }).enabled).toBe(true);
  });

  it('builds Gmail SMTP settings, strips app-password spaces and sends from the account', () => {
    const settings = emailSettings({
      EMAIL_PROVIDER: 'smtp',
      EMAIL_ENABLED: 'true',
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_PORT: 465,
      SMTP_USER: 'someone@gmail.com',
      SMTP_PASSWORD: 'abcd efgh ijkl mnop',
      SES_FROM_EMAIL: 'noreply@codementor.cloud',
    });
    expect(settings.smtp).toEqual({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      user: 'someone@gmail.com',
      password: 'abcdefghijklmnop',
    });
    // Gmail rewrites any other From, so the SES sender must not leak into SMTP mail.
    expect(settings.fromAddress).toBe('someone@gmail.com');
  });

  it('uses STARTTLS on 587 unless SMTP_SECURE says otherwise', () => {
    const smtp = (extra: Record<string, unknown>) =>
      emailSettings({
        EMAIL_PROVIDER: 'smtp',
        SMTP_HOST: 'smtp.example.test',
        SMTP_USER: 'u@example.test',
        SMTP_PASSWORD: 'p',
        ...extra,
      }).smtp;
    expect(smtp({ SMTP_PORT: 587 })?.secure).toBe(false);
    expect(smtp({ SMTP_PORT: 587, SMTP_SECURE: 'true' })?.secure).toBe(true);
  });

  it('prefers an explicit EMAIL_FROM_ADDRESS', () => {
    expect(
      emailSettings({ EMAIL_PROVIDER: 'smtp', SMTP_USER: 'a@gmail.com', EMAIL_FROM_ADDRESS: 'alias@gmail.com' })
        .fromAddress,
    ).toBe('alias@gmail.com');
  });

  it('reads through a ConfigService-style getter', () => {
    const values: Record<string, unknown> = { EMAIL_PROVIDER: 'smtp', EMAIL_ENABLED: 'true' };
    expect(emailSettings(fromConfig((key) => values[key])).provider).toBe('smtp');
  });
});

describe('emailSettingsIssues / validateEnv', () => {
  it('requires SMTP credentials only while SMTP email is enabled', () => {
    expect(emailSettingsIssues({ EMAIL_PROVIDER: 'smtp', EMAIL_ENABLED: 'false' })).toEqual([]);
    expect(emailSettingsIssues({ EMAIL_PROVIDER: 'smtp', EMAIL_ENABLED: 'true', SMTP_HOST: 'h' })).toEqual([
      'SMTP_USER: bắt buộc khi EMAIL_PROVIDER=smtp và email đang bật',
      'SMTP_PASSWORD: bắt buộc khi EMAIL_PROVIDER=smtp và email đang bật',
    ]);
  });

  it('fails fast at startup on an incomplete SMTP configuration', () => {
    expect(() => validateEnv({ ...base, EMAIL_PROVIDER: 'smtp', EMAIL_ENABLED: 'true' })).toThrow(
      /SMTP_HOST/,
    );
  });

  it('accepts a complete SMTP configuration and an untouched SES one', () => {
    expect(() =>
      validateEnv({
        ...base,
        EMAIL_PROVIDER: 'smtp',
        EMAIL_ENABLED: 'true',
        SMTP_HOST: 'smtp.gmail.com',
        SMTP_USER: 'someone@gmail.com',
        SMTP_PASSWORD: 'abcdefghijklmnop',
      }),
    ).not.toThrow();
    expect(validateEnv(base).EMAIL_PROVIDER).toBe('ses');
  });
});

describe('validateEnv with a freshly copied .env.example', () => {
  it('treats blank optional email variables as unset', () => {
    const parsed = validateEnv({
      ...base,
      EMAIL_PROVIDER: 'ses',
      EMAIL_ENABLED: '',
      EMAIL_FROM_ADDRESS: '',
      SMTP_USER: '',
      SMTP_PASSWORD: '',
    });
    expect(parsed.EMAIL_FROM_ADDRESS).toBeUndefined();
    expect(emailSettings(parsed).enabled).toBe(false);
  });
});

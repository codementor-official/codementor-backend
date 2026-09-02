import { ConfigService } from '@nestjs/config';
import { EmailVerificationService } from './email-verification.service';
import { Email } from '../domain/model/email';
import { User } from '../domain/model/user';
import type { UserRepository } from '../domain/port/user.repository';
import type { EmailVerificationProvider } from '../domain/port/email-verification.provider';
import { KeycloakAdminService } from '../infrastructure/keycloak-admin.service';

// Isolate the adapter from the unrelated Passport/JWKS ESM bootstrap.
jest.mock('@codementor/platform', () => ({ HUMAN_ROLES: ['STUDENT', 'LECTURER', 'ADMIN'] }));

const provision = (verified = false) => User.provision({
  id: 'local-user', externalId: 'keycloak-user', email: Email.create('learner@example.com').value,
  displayName: 'Learner', emailVerified: verified, role: 'learner',
});

describe('Self-service email verification', () => {
  let user: User;
  let users: jest.Mocked<UserRepository>;
  let provider: jest.Mocked<EmailVerificationProvider>;
  let service: EmailVerificationService;
  beforeEach(() => {
    user = provision();
    users = { findById: jest.fn().mockResolvedValue(user), findByExternalId: jest.fn(), findByEmail: jest.fn(), save: jest.fn().mockResolvedValue(undefined) };
    provider = { emailStatus: jest.fn().mockResolvedValue({ email: 'learner@example.com', verified: false, canSend: true }), sendVerificationEmail: jest.fn().mockResolvedValue(undefined) };
    service = new EmailVerificationService(users, provider);
  });

  it('sends only to the authenticated local account mapped to its Keycloak subject', async () => {
    expect(await service.send('local-user')).toMatchObject({ sent: true, verified: false });
    expect(users.findById).toHaveBeenCalledWith('local-user');
    expect(provider.sendVerificationEmail).toHaveBeenCalledWith('keycloak-user');
    expect(user.isEmailVerified).toBe(false);
    expect(users.save).not.toHaveBeenCalled();
  });

  it('synchronizes proof from Keycloak, allowing stale access tokens to remain usable', async () => {
    provider.emailStatus.mockResolvedValue({ email: 'learner@example.com', verified: true, canSend: false });
    expect(await service.status('local-user')).toMatchObject({ verified: true });
    expect(user.isEmailVerified).toBe(true);
    expect(users.save).toHaveBeenCalledWith(user);
    user.syncFromProvider({ email: user.email, displayName: user.displayName, emailVerified: false, role: 'learner' });
    expect(user.isEmailVerified).toBe(true); // A pre-verification token must not undo new proof.
  });

  it('does not send another email when Keycloak already verified the mailbox', async () => {
    provider.emailStatus.mockResolvedValue({ email: 'learner@example.com', verified: true, canSend: false });
    expect(await service.send('local-user')).toMatchObject({ verified: true, sent: false });
    expect(provider.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('does not claim delivery when SMTP is unavailable', async () => {
    provider.emailStatus.mockResolvedValue({ email: 'learner@example.com', verified: false, canSend: false });
    await expect(service.send('local-user')).rejects.toMatchObject({ status: 503 });
    expect(provider.sendVerificationEmail).not.toHaveBeenCalled();
    expect(user.isEmailVerified).toBe(false);
  });

  it('prevents concurrent sends and keeps the cooldown after ambiguous failures', async () => {
    provider.sendVerificationEmail.mockRejectedValue(new Error('timeout'));
    const first = service.send('local-user');
    await expect(service.send('local-user')).rejects.toMatchObject({ status: 429 });
    await expect(first).rejects.toThrow('timeout');
    await expect(service.send('local-user')).rejects.toMatchObject({ status: 429 });
    expect(provider.sendVerificationEmail).toHaveBeenCalledTimes(1);
  });

  it('allows resending after the cooldown', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(100_000);
    try {
      await service.send('local-user');
      clock.mockReturnValue(161_000);
      expect(await service.send('local-user')).toMatchObject({ sent: true });
      expect(provider.sendVerificationEmail).toHaveBeenCalledTimes(2);
    } finally { clock.mockRestore(); }
  });

  it('refuses a changed mailbox rather than verifying the wrong address', async () => {
    provider.emailStatus.mockResolvedValue({ email: 'different@example.com', verified: true, canSend: false });
    await expect(service.send('local-user')).rejects.toMatchObject({ status: 409 });
    expect(users.save).not.toHaveBeenCalled();
    expect(provider.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('does not reach Keycloak for a deleted or unknown local user', async () => {
    user.softDelete();
    await expect(service.status('local-user')).rejects.toThrow();
    users.findById.mockResolvedValue(null);
    await expect(service.status('missing')).rejects.toThrow();
    expect(provider.emailStatus).not.toHaveBeenCalled();
  });

  it('clears verification when the identity provider changes the email address', () => {
    const verifiedUser = provision(true);
    verifiedUser.syncFromProvider({ email: Email.create('new@example.com').value, displayName: 'Learner', emailVerified: false, role: 'learner' });
    expect(verifiedUser.isEmailVerified).toBe(false);
  });

  it('does not infer verification when the provider check fails', async () => {
    provider.emailStatus.mockRejectedValue(new Error('unavailable'));
    await expect(service.status('local-user')).rejects.toThrow('unavailable');
    expect(users.save).not.toHaveBeenCalled();
  });
});

describe('Keycloak verification adapter', () => {
  const config = new ConfigService({ KEYCLOAK_URL: 'https://identity.example.com', KEYCLOAK_REALM: 'test', KEYCLOAK_USER_SERVICE_CLIENT_ID: 'service', KEYCLOAK_USER_SERVICE_CLIENT_SECRET: 'test-only', CLIENT_APP_URL: 'http://localhost:3000' });
  afterEach(() => jest.restoreAllMocks());

  it('uses Keycloak send-verify-email with a server-owned redirect and 30-minute lifespan', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'test-token', expires_in: 60 })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await new KeycloakAdminService(config).sendVerificationEmail('kc-user');
    const [url, init] = fetchMock.mock.calls[1];
    const target = new URL(String(url));
    expect(target.pathname).toBe('/admin/realms/test/users/kc-user/send-verify-email');
    expect(target.searchParams.get('redirect_uri')).toBe('http://localhost:3000/profile?tab=settings');
    expect(target.searchParams.get('client_id')).toBe('codementor-web');
    expect(target.searchParams.get('lifespan')).toBe('1800');
    expect(init?.method).toBe('PUT');
  });

  it('reports missing SMTP without attempting to send', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'test-token', expires_in: 60 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'kc-user', email: 'learner@example.com', enabled: true, emailVerified: false })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ smtpServer: {} })));
    expect(await new KeycloakAdminService(config).emailStatus('kc-user')).toEqual({ email: 'learner@example.com', verified: false, canSend: false });
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('send-verify-email'))).toBe(true);
  });
});

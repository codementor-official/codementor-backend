import { ConfigService } from '@nestjs/config';
import { PasswordResetService, maskEmail } from './password-reset.service';

jest.mock('@codementor/messaging', () => ({ EVENT_BUS: Symbol('EVENT_BUS') }));
jest.mock('../infrastructure/keycloak-admin.service', () => ({ KeycloakAdminService: class {} }));

const ID = '3f1c2a9e-1b2c-4d5e-8f90-123456789abc';

function setup() {
  let stamp = '1700000000000';
  const account = { id: ID, email: 'owner@example.test', displayName: 'Owner', enabled: true };
  const keycloak = {
    findByEmail: jest.fn(async (email: string) => (email === account.email ? account : null)),
    account: jest.fn(async () => account),
    passwordStamp: jest.fn(async () => stamp),
    setPassword: jest.fn(async () => { stamp = String(Date.now()); }),
    logoutSessions: jest.fn(),
  };
  const eventBus = { publish: jest.fn() };
  const service = new PasswordResetService(keycloak as never, eventBus as never,
    new ConfigService({ KEYCLOAK_USER_SERVICE_CLIENT_SECRET: 'secret' }));
  const token = () => eventBus.publish.mock.calls.at(-1)![1].token as string;
  return { service, keycloak, eventBus, token, account };
}

describe('PasswordResetService', () => {
  it('emails a link only for a known, enabled account and answers the same otherwise', async () => {
    const { service, eventBus } = setup();
    await service.request('nobody@example.test', 'ip');
    expect(eventBus.publish).not.toHaveBeenCalled();
    await service.request(' Owner@Example.test ', 'ip');
    expect(eventBus.publish).toHaveBeenCalledWith('cmd.identity.password-reset-email.v1',
      expect.objectContaining({ email: 'owner@example.test', displayName: 'Owner' }));
  });

  it('sends at most one email per address per minute', async () => {
    const { service, eventBus } = setup();
    await service.request('owner@example.test', 'ip');
    await service.request('owner@example.test', 'ip');
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
  });

  it('accepts its link once: the new password voids it', async () => {
    const { service, keycloak, token } = setup();
    await service.request('owner@example.test', 'ip');
    const link = token();
    await expect(service.check(link, 'ip')).resolves.toEqual({ valid: true, email: 'ow•••r@example.test' });
    await service.reset(link, 'new-password-1', 'ip');
    expect(keycloak.setPassword).toHaveBeenCalledWith(ID, 'new-password-1');
    expect(keycloak.logoutSessions).toHaveBeenCalledWith(ID);
    await expect(service.check(link, 'ip')).resolves.toEqual({ valid: false, email: null });
    await expect(service.reset(link, 'another-pass', 'ip')).rejects.toThrow('hết hạn hoặc đã được dùng');
  });

  it('refuses a tampered, foreign or expired link', async () => {
    const { service, token } = setup();
    await service.request('owner@example.test', 'ip');
    const [id, expires, sig] = token().split('.');
    const other = new PasswordResetService({} as never, {} as never, new ConfigService({ KEYCLOAK_USER_SERVICE_CLIENT_SECRET: 'other' }));
    expect((await service.check(`${id}.${expires}.${sig.slice(1)}x`, 'ip')).valid).toBe(false);
    expect((await service.check(`${id}.${Number(expires) + 1}.${sig}`, 'ip')).valid).toBe(false);
    expect((await service.check(`${id}.1600000000000.${sig}`, 'ip')).valid).toBe(false);
    expect((await other.check('junk', 'ip')).valid).toBe(false);
  });

  it('masks the email it shows', () => {
    expect(maskEmail('nguyenvana@gmail.com')).toBe('ng•••a@gmail.com');
    expect(maskEmail('ab@x.vn')).toBe('a•••@x.vn');
  });
});

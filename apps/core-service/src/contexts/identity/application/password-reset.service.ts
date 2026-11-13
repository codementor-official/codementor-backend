import { HttpException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { BusinessRuleViolation } from '@codementor/kernel';
import { EVENT_BUS, type EventBus } from '@codementor/messaging';
import { TOPICS } from '@codementor/contracts';
import { KeycloakAdminService, type ResetAccount } from '../infrastructure/keycloak-admin.service';

const LINK_TTL_MS = 30 * 60_000;

/**
 * "Forgot password" on CodeMentor's own pages instead of Keycloak's.
 *
 * The link token is stateless: `base64url(keycloakId).expiresAtMs.hmac`, the HMAC also covering
 * the account's current password stamp. It expires after 30 minutes and stops working the
 * moment the password changes, so it works once; nothing is stored.
 */
@Injectable()
export class PasswordResetService {
  private readonly key: Buffer;
  // shortcut: counters live in this instance only; move to Redis or Kong rate limiting if core-service scales out.
  private readonly hits = new Map<string, { count: number; until: number }>();

  constructor(
    private readonly keycloak: KeycloakAdminService,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
    config: ConfigService,
  ) {
    // Derived from the service-account secret so no new secret has to be deployed; rotating that
    // secret voids open links, which is fine for 30-minute links.
    this.key = createHmac('sha256', config.getOrThrow<string>('KEYCLOAK_USER_SERVICE_CLIENT_SECRET'))
      .update('codementor:password-reset:v1')
      .digest();
  }

  /** Always answers the same way, so the form never tells whether an email has an account. */
  async request(email: string, ip: string): Promise<void> {
    this.limit(`request:${ip}`, 10, 60 * 60_000);
    const address = email.trim().toLowerCase();
    // One email per address per minute; quietly, like an unknown address.
    if (!this.allow(`email:${address}`, 1, 60_000)) return;
    const account = await this.keycloak.findByEmail(address);
    if (!account?.enabled || !account.email) return;
    const expiresAt = Date.now() + LINK_TTL_MS;
    const body = `${Buffer.from(account.id).toString('base64url')}.${expiresAt}`;
    const token = `${body}.${this.mac(body, await this.keycloak.passwordStamp(account.id))}`;
    await this.eventBus.publish(TOPICS.PASSWORD_RESET_EMAIL, {
      email: account.email,
      displayName: account.displayName,
      token,
      expiresAt: new Date(expiresAt).toISOString(),
    });
  }

  async check(token: string, ip: string) {
    this.limit(`token:${ip}`, 30, 10 * 60_000);
    const account = await this.verify(token);
    return { valid: Boolean(account), email: account ? maskEmail(account.email) : null };
  }

  async reset(token: string, password: string, ip: string) {
    this.limit(`token:${ip}`, 30, 10 * 60_000);
    const account = await this.verify(token);
    if (!account)
      throw new BusinessRuleViolation('Liên kết đặt lại mật khẩu đã hết hạn hoặc đã được dùng. Hãy yêu cầu liên kết mới.', {
        code: 'PASSWORD_RESET_LINK_INVALID',
      });
    await this.keycloak.setPassword(account.id, password);
    // Whoever knew the old password is signed out everywhere.
    await this.keycloak.logoutSessions(account.id);
    return { email: account.email };
  }

  private async verify(token: string): Promise<ResetAccount | null> {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [id64, expires, signature] = parts;
    if (!/^\d{13}$/.test(expires) || Number(expires) < Date.now()) return null;
    const id = Buffer.from(id64, 'base64url').toString();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return null;
    const account = await this.keycloak.account(id).catch(() => null);
    if (!account?.enabled) return null;
    const expected = Buffer.from(this.mac(`${id64}.${expires}`, await this.keycloak.passwordStamp(id)));
    const given = Buffer.from(signature);
    return given.length === expected.length && timingSafeEqual(given, expected) ? account : null;
  }

  private mac(body: string, stamp: string): string {
    return createHmac('sha256', this.key).update(`${body}.${stamp}`).digest('base64url');
  }

  private allow(key: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    for (const [k, v] of this.hits) if (v.until <= now) this.hits.delete(k);
    const hit = this.hits.get(key) ?? { count: 0, until: now + windowMs };
    hit.count += 1;
    this.hits.set(key, hit);
    return hit.count <= max;
  }

  private limit(key: string, max: number, windowMs: number) {
    if (!this.allow(key, max, windowMs))
      throw new HttpException({ message: 'Bạn đã thử quá nhiều lần. Vui lòng đợi một lúc rồi thử lại.' }, 429);
  }
}

/** `nguyenvana@gmail.com` → `ng•••a@gmail.com`: enough to recognise, not to harvest. */
export function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!domain) return '•••';
  return `${name.slice(0, Math.min(2, name.length - 1))}•••${name.length > 2 ? name.slice(-1) : ''}@${domain}`;
}

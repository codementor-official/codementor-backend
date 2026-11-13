import { notifyAdmins, notifyCommerce } from '../../commerce/infrastructure/commerce-notification';
import type { Tx } from '../../commerce/infrastructure/commerce.store';

/** Billing notices an administrator can switch, as stored in `workspace_billing_settings.notices`. */
export const NOTICE_KEYS = [
  'subscription_paid', 'payment_review', 'refund', 'renewal_reminder', 'grace_notice', 'overage_notice', 'admin_alert',
] as const;
export type NoticeKey = (typeof NOTICE_KEYS)[number];
/** `all`: in the app and by email; `app`: in the app only; `off`: not sent. */
export const NOTICE_MODES = ['all', 'app', 'off'] as const;
export type NoticeMode = (typeof NOTICE_MODES)[number];

/** Every key with its mode; a key never set is `all`, and the admin alert has no email so `all` reads `app`. */
export function noticeModes(stored: Record<string, unknown> | null | undefined): Record<NoticeKey, NoticeMode> {
  return Object.fromEntries(NOTICE_KEYS.map((key) => {
    const mode = NOTICE_MODES.includes(stored?.[key] as NoticeMode) ? (stored![key] as NoticeMode) : 'all';
    return [key, key === 'admin_alert' && mode === 'all' ? 'app' : mode];
  })) as Record<NoticeKey, NoticeMode>;
}

async function modeOf(tx: Tx, key: NoticeKey): Promise<NoticeMode> {
  const [row] = await tx.$queryRaw<{ notices: Record<string, unknown> }[]>`SELECT notices FROM workspace_billing_settings`;
  return noticeModes(row?.notices)[key];
}

/** `notifyCommerce` as the administrator set this notice: skipped when off, kept out of email when in-app only. */
export async function notifyBilling(
  tx: Tx, key: Exclude<NoticeKey, 'admin_alert'>, userId: string, entityId: string, title: string, message: string, actionUrl: string,
) {
  const mode = await modeOf(tx, key);
  if (mode !== 'off') await notifyCommerce(tx, userId, entityId, title, message, actionUrl, mode === 'all');
}

/** `notifyAdmins` unless the administrators turned their billing alerts off. */
export async function notifyBillingAdmins(tx: Tx, entityId: string, title: string, message: string, actionUrl: string) {
  if ((await modeOf(tx, 'admin_alert')) !== 'off') await notifyAdmins(tx, entityId, title, message, actionUrl);
}

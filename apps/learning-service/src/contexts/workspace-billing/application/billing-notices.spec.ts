import { noticeModes } from './billing-notices';

describe('billing notice modes', () => {
  it('reads unset or unknown modes as on, and the admin alert as in-app only', () => {
    const modes = noticeModes({ refund: 'off', grace_notice: 'app', renewal_reminder: 'bogus', admin_alert: 'all' });
    expect(modes).toMatchObject({ refund: 'off', grace_notice: 'app', renewal_reminder: 'all', subscription_paid: 'all', admin_alert: 'app' });
    expect(noticeModes(null).payment_review).toBe('all');
  });
});

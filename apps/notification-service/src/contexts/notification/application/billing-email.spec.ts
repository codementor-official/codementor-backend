import { ConfigService } from '@nestjs/config';
import { NotificationContent } from '../domain/model/notification-content';
import { permitsEmail, type Recipient } from '../domain/model/reminder';
import { ReminderPlanner } from './reminder-planner';

jest.mock('../infrastructure/reminder.repository', () => ({ ReminderRepository: class {} }));

const buyer: Recipient = { id: 'user', external_id: 'subject', email: 'buyer@example.test', display_name: 'Buyer',
  timezone: 'Asia/Ho_Chi_Minh', status: 'active', email_verified_at: new Date(), email_enabled: true,
  learning_enabled: true, preferences: { systemAnnouncements: false } };

const notice = (actionUrl: string) =>
  NotificationContent.create({ type: 'COMMERCE_UPDATED', title: 'Đã hoàn tiền gói Workspace', message: 'Đã hoàn 95.700 ₫.',
    audienceType: 'USER', audienceKey: 'subject', referenceType: 'COMMERCE', referenceId: 'order',
    actionUrl, actionLabel: 'Xem giao dịch', metadata: { entityId: 'order' } }).value;

describe('Workspace billing email', () => {
  it("queues the buyer's billing notice as a billing email", async () => {
    const repo = { schedule: jest.fn(), recipientByExternalId: jest.fn().mockResolvedValue(buyer) };
    await new ReminderPlanner(repo as never, new ConfigService()).fromNotification({ eventId: 'event' } as never,
      notice('/workspace/billing/checkout/result?order=order'));
    expect(repo.schedule).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user', type: 'BILLING_UPDATE', category: 'billing',
      payload: expect.objectContaining({ actionUrl: '/workspace/billing/checkout/result?order=order' }) }));
  });
  it('does not email the admin copy, which links into the admin app', async () => {
    const repo = { schedule: jest.fn(), recipientByExternalId: jest.fn().mockResolvedValue(buyer) };
    await new ReminderPlanner(repo as never, new ConfigService()).fromNotification({ eventId: 'event' } as never,
      notice('/workspace-plans?tab=orders&order=order'));
    expect(repo.schedule).not.toHaveBeenCalled();
  });
  it('keeps a notice the administrator set to in-app only out of email', async () => {
    const repo = { schedule: jest.fn(), recipientByExternalId: jest.fn().mockResolvedValue(buyer) };
    const appOnly = NotificationContent.create({ type: 'COMMERCE_UPDATED', title: 'Đã gia hạn', message: 'Hiệu lực đến 05/12/2026.',
      audienceType: 'USER', audienceKey: 'subject', referenceType: 'COMMERCE', referenceId: 'order',
      actionUrl: '/workspace/billing', actionLabel: 'Xem giao dịch', metadata: { entityId: 'order', email: false } }).value;
    await new ReminderPlanner(repo as never, new ConfigService()).fromNotification({ eventId: 'event' } as never, appOnly);
    expect(repo.schedule).not.toHaveBeenCalled();
  });
  it('sends billing email even with system announcements turned off, never to an unverified address', () => {
    expect(permitsEmail(buyer, 'BILLING_UPDATE', 'billing')).toBe(true);
    expect(permitsEmail({ ...buyer, email_verified_at: null }, 'BILLING_UPDATE', 'billing')).toBe(false);
  });
});

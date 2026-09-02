import { ConfigService } from '@nestjs/config';
import { NotificationContent } from '../domain/model/notification-content';
import type { Recipient, Reminder } from '../domain/model/reminder';
import { ReminderPlanner } from './reminder-planner';
import { ReminderDispatcher } from './reminder-dispatcher';

jest.mock('../infrastructure/reminder.repository', () => ({ ReminderRepository: class {} }));
jest.mock('./record-notification.usecase', () => ({ RecordNotificationUseCase: class {} }));

const user: Recipient = { id: 'user', external_id: 'subject', email: 'demo@example.test', display_name: 'Member',
  timezone: 'Asia/Ho_Chi_Minh', status: 'active', email_verified_at: new Date(), email_enabled: true,
  learning_enabled: true, workspace_enabled: false, preferences: { workspaceEmailUpdates: true } };
const types = ['WORKSPACE_DOCUMENT_PENDING', 'WORKSPACE_DOCUMENT_PUBLISHED', 'WORKSPACE_DOCUMENT_REJECTED'] as const;
describe('Workspace document email planning', () => {
  it.each(types)('queues %s independently of the in-app preference, retaining resource references', async (type) => {
    const repo = { schedule: jest.fn(), recipientByExternalId: jest.fn().mockResolvedValue(user) };
    const planner = new ReminderPlanner(repo as never, new ConfigService());
    const content = NotificationContent.create({ type, title: 'Tài liệu', message: 'Nhóm có cập nhật tài liệu.',
      audienceType: 'USER', audienceKey: 'subject', referenceType: 'WORKSPACE', referenceId: 'group',
      actionUrl: '/workspace/dsa?tab=documents', actionLabel: 'Xem tài liệu', metadata: { entityId: 'doc' } });
    await planner.fromNotification({ eventId: 'event' } as never, content.value);
    expect(repo.schedule).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user', type, category: 'workspace',
      entityType: 'WORKSPACE_DOCUMENT', entityId: 'doc', dedupeKey: 'notification:event:user',
      payload: expect.objectContaining({ referenceId: 'group', actionUrl: '/workspace/dsa?tab=documents' }) }));
  });
  it('does not turn chat into email', async () => {
    const repo = { schedule: jest.fn() };
    const planner = new ReminderPlanner(repo as never, new ConfigService());
    await planner.fromNotification({ eventId: 'event' } as never, { type: 'WORKSPACE_MESSAGE' } as never);
    expect(repo.schedule).not.toHaveBeenCalled();
  });
});

describe('Workspace document email delivery guards', () => {
  const r: Reminder = { id: 'reminder', user_id: 'user', type: 'WORKSPACE_DOCUMENT_PUBLISHED', category: 'workspace',
    entity_type: 'WORKSPACE_DOCUMENT', entity_id: 'doc', source_version: null, scheduled_at: new Date(), status: 'PROCESSING',
    processing_token: 'token', retry_count: 0, payload: { title: 'Document', message: 'A new document', referenceId: 'group', actionUrl: '/workspace/dsa?tab=documents', actionLabel: 'Open' } };
  function setup(recipient = user, eligible = true) {
    const repo = { recipient: jest.fn().mockResolvedValue(recipient), workspaceDocumentEligible: jest.fn().mockResolvedValue(eligible),
      skip: jest.fn(), startDelivery: jest.fn().mockResolvedValue(true), sent: jest.fn() };
    const provider = { send: jest.fn().mockResolvedValue({ messageId: 'ses-id' }) };
    const record = { record: jest.fn() };
    const worker = new ReminderDispatcher(repo as never, new ConfigService({ SES_ENABLED: true, CLIENT_APP_URL: 'http://localhost:3000' }), provider, record as never);
    return { repo, provider, record, worker };
  }
  it('rechecks current resource state and permission immediately before sending', async () => {
    const { worker, repo, provider } = setup(user, false);
    await worker.deliver(r);
    expect(repo.skip).toHaveBeenCalledWith(r, user, 'DOCUMENT_REMOVED_STATE_CHANGED_OR_PERMISSION_REVOKED');
    expect(provider.send).not.toHaveBeenCalled();
  });
  it.each([
    { ...user, email_enabled: false },
    { ...user, preferences: { workspaceEmailUpdates: false } },
    { ...user, email_verified_at: null },
  ])('honors email master, Workspace category and verification on dispatch', async (recipient) => {
    const { worker, provider, repo } = setup(recipient);
    await worker.deliver(r);
    expect(provider.send).not.toHaveBeenCalled();
    expect(repo.skip).toHaveBeenCalledWith(r, recipient, 'EMAIL_PREFERENCE_OR_VERIFICATION');
  });
  it('sends email even with in-app off, without creating a second bell notification', async () => {
    const { worker, provider, record, repo } = setup();
    await worker.deliver(r);
    expect(provider.send).toHaveBeenCalledWith(expect.objectContaining({ recipient: user.email }));
    expect(repo.sent).toHaveBeenCalledWith(r, 'ses-id');
    expect(record.record).not.toHaveBeenCalled();
  });
});

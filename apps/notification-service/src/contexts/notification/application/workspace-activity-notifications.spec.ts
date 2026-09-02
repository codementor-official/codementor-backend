import { ConfigService } from '@nestjs/config';
import { WorkspaceActivityNotifications } from './workspace-activity-notifications';
import { ReminderPlanner } from './reminder-planner';
import { RecordNotificationUseCase } from './record-notification.usecase';
import { NotificationContent } from '../domain/model/notification-content';

jest.mock('../infrastructure/reminder.repository', () => ({ ReminderRepository: class {} }));
jest.mock('../infrastructure/workspace-activity.repository', () => ({ WorkspaceActivityRepository: class {} }));
jest.mock('@codementor/messaging', () => ({ EVENT_BUS: Symbol('bus') }));

describe('Workspace notification routing', () => {
  const members = [
    { user_id: 'owner', external_id: 'sub-owner', role: 'owner', status: 'active', can_view_doc: true, can_approve_doc: true },
    { user_id: 'deputy', external_id: 'sub-deputy', role: 'deputy', status: 'active', can_view_doc: true, can_approve_doc: false },
    { user_id: 'member', external_id: 'sub-member', role: 'member', status: 'active', can_view_doc: true, can_approve_doc: false },
    { user_id: 'blocked', external_id: 'sub-blocked', role: 'member', status: 'active', can_view_doc: false, can_approve_doc: true },
    { user_id: 'removed', external_id: 'sub-removed', role: 'member', status: 'removed', can_view_doc: true, can_approve_doc: true },
  ];
  const repo = {
    workspace: jest.fn().mockResolvedValue({ id: 'group', name: 'DSA', slug: 'dsa' }),
    members: jest.fn().mockResolvedValue(members), document: jest.fn(), pendingRequest: jest.fn(),
  };
  const recipients = { recipient: jest.fn().mockResolvedValue({ display_name: 'Member' }) };
  const record = { record: jest.fn() };
  const handler = new WorkspaceActivityNotifications(repo as never, recipients as never, record as never);
  const event = { eventId: 'event', correlationId: 'event' } as never;
  const published = { groupId: 'group', entityId: 'doc', action: 'document_published' as const, actorUserId: 'owner', memberUserId: null };
  const audiences = () => record.record.mock.calls.map(([, result]) => result.value.audienceKey);
  beforeEach(() => { jest.clearAllMocks(); repo.document.mockResolvedValue({ id: 'doc', title: 'Stack', status: 'published', uploader_id: 'member' }); });
  it('announces an approved document only to active members who can view it, excluding actor', async () => {
    await handler.handle(published, event);
    expect(audiences()).toEqual(['sub-deputy', 'sub-member']);
    expect(record.record.mock.calls[0][1].value.actionUrl).toBe('/workspace/dsa?tab=documents');
    expect(record.record.mock.calls[0][0].eventId).toBe('document-published:doc:sub-deputy');
  });
  it('does not leak pending documents to members or revoked approvers', async () => {
    repo.document.mockResolvedValue({ title: 'Stack', status: 'pending', uploader_id: 'member' });
    await handler.handle({ ...published, action: 'document_pending', actorUserId: 'member' }, event);
    expect(audiences()).toEqual(['sub-owner']);
  });
  it('notifies only the uploader on rejection', async () => {
    repo.document.mockResolvedValue({ title: 'Stack', status: 'hidden', uploader_id: 'member' });
    await handler.handle({ ...published, action: 'document_rejected' }, event);
    expect(audiences()).toEqual(['sub-member']);
  });
  it('ignores deleted documents and stale publication events', async () => {
    repo.document.mockResolvedValue({ status: 'hidden' });
    await handler.handle(published, event);
    repo.document.mockResolvedValue({ status: 'published', deleted_at: new Date() });
    await handler.handle(published, event);
    expect(record.record).not.toHaveBeenCalled();
  });
  it('sends a pending join request to the owner, not ordinary members', async () => {
    repo.pendingRequest.mockResolvedValue({ user_id: 'outsider' });
    await handler.handle({ ...published, action: 'join_requested', actorUserId: 'outsider', memberUserId: 'outsider' }, event);
    expect(audiences()).toEqual(['sub-owner']);
  });
  it('announces leaving without falsely saying a member voluntarily left', async () => {
    await handler.handle({ ...published, action: 'member_left', actorUserId: null, memberUserId: 'removed' }, event);
    expect(audiences()).not.toContain('sub-removed');
    expect(record.record.mock.calls[0][1].value.message).toContain('không còn là thành viên');
  });
});

describe('In-app and email switches are independent', () => {
  const recipientByExternalId = jest.fn();
  const planner = new ReminderPlanner({ recipientByExternalId } as never, new ConfigService());
  const content = NotificationContent.create({ type: 'WORKSPACE_JOIN_APPROVED', title: 'Welcome', message: 'Joined',
    audienceType: 'USER', audienceKey: 'subject', referenceType: 'WORKSPACE', referenceId: 'group' });
  it('checks the saved Workspace switch and active account for every Workspace notification', async () => {
    recipientByExternalId.mockResolvedValue({ status: 'active', workspace_enabled: false });
    expect(await planner.allowsInApp(content.value)).toBe(false);
    recipientByExternalId.mockResolvedValue({ status: 'active', workspace_enabled: true, email_enabled: false });
    expect(await planner.allowsInApp(content.value)).toBe(true);
    recipientByExternalId.mockResolvedValue({ status: 'inactive', workspace_enabled: true });
    expect(await planner.allowsInApp(content.value)).toBe(false);
  });
  it('keeps selected email scheduling when in-app Workspace notifications are disabled', async () => {
    const mail = { fromNotification: jest.fn(), allowsInApp: jest.fn().mockResolvedValue(false) };
    const repository = { create: jest.fn() }, bus = { publish: jest.fn() };
    const record = new RecordNotificationUseCase(repository as never, bus as never, mail as never);
    await record.record({ eventId: 'event' } as never, content);
    expect(mail.fromNotification).toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
    expect(bus.publish).not.toHaveBeenCalled();
  });
});

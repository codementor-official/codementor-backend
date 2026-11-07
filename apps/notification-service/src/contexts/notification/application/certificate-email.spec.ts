import { ConfigService } from '@nestjs/config';
import type { Result } from '@codementor/kernel';
import type { NotificationContent } from '../domain/model/notification-content';
import type { Recipient, Reminder } from '../domain/model/reminder';
import { ReminderDispatcher } from './reminder-dispatcher';

jest.mock('../infrastructure/reminder.repository', () => ({ ReminderRepository: class {} }));
jest.mock('./record-notification.usecase', () => ({ RecordNotificationUseCase: class {} }));

const user: Recipient = {
  id: 'user', external_id: 'subject', email: 'learner@example.test', display_name: 'An',
  timezone: 'Asia/Ho_Chi_Minh', status: 'active', email_verified_at: new Date(), email_enabled: true,
  learning_enabled: true, workspace_enabled: false, preferences: {},
};
const certificate = (id: string, payload: Partial<Reminder['payload']> = {}): Reminder => ({
  id, user_id: 'user', type: 'CERTIFICATE_ISSUED', category: 'learning', entity_type: 'CERTIFICATE', entity_id: 'cert',
  source_version: null, scheduled_at: new Date(), status: 'PROCESSING', processing_token: 'token', retry_count: 0,
  payload: {
    title: 'Chứng chỉ đã được cấp', message: 'Mã xác thực K7Q2M9XD3F.', actionUrl: '/certificates/K7Q2M9XD3F',
    actionLabel: 'Xem chứng chỉ', referenceType: 'ROADMAP', referenceId: 'roadmap1', ...payload,
  },
});

function setup() {
  const repo = {
    recipient: jest.fn().mockResolvedValue(user), skip: jest.fn(), startDelivery: jest.fn().mockResolvedValue(true),
    sent: jest.fn(), recover: jest.fn(), syncStudySchedules: jest.fn(), claim: jest.fn(),
  };
  const provider = { send: jest.fn().mockResolvedValue({ messageId: 'ses-id' }) };
  // Same contract as RecordNotificationUseCase: an invalid draft is a programming error and throws.
  const record = {
    record: jest.fn(async (_envelope: unknown, draft: Result<NotificationContent, Error>) => {
      if (draft.isFail) throw draft.error;
    }),
  };
  const worker = new ReminderDispatcher(
    repo as never, new ConfigService({ SES_ENABLED: true, CLIENT_APP_URL: 'http://localhost:3000' }), provider, record as never,
  );
  return { repo, provider, record, worker };
}

describe('Certificate issued delivery', () => {
  it('records the bell notification against the course/roadmap and sends the email', async () => {
    const { worker, record, provider, repo } = setup();
    const r = certificate('r1');
    await worker.deliver(r);
    const draft = record.record.mock.calls[0][1];
    expect(draft.isOk).toBe(true);
    expect(draft.value).toMatchObject({ type: 'CERTIFICATE_ISSUED', referenceType: 'ROADMAP', referenceId: 'roadmap1' });
    expect(provider.send).toHaveBeenCalledWith(expect.objectContaining({ recipient: user.email }));
    expect(repo.sent).toHaveBeenCalledWith(r, 'ses-id');
  });

  it('keeps working through the queue when one reminder throws', async () => {
    const { worker, repo, provider } = setup();
    // A row queued before referenceType existed: its notification is invalid and throws.
    repo.claim
      .mockResolvedValueOnce(certificate('broken', { referenceType: undefined }))
      .mockResolvedValueOnce(certificate('next'))
      .mockResolvedValueOnce(undefined);
    await worker.run();
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(repo.sent).toHaveBeenCalledWith(expect.objectContaining({ id: 'next' }), 'ses-id');
  });
});

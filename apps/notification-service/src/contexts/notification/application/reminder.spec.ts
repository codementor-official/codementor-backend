import { ConfigService } from '@nestjs/config';
import { permitsEmail, type Recipient } from '../domain/model/reminder';
import type { ReminderRepository } from '../infrastructure/reminder.repository';
import { ReminderPlanner } from './reminder-planner';
import { renderEmail } from './email-template';

// Planner unit tests do not boot authentication/database dependencies.
jest.mock('../infrastructure/reminder.repository', () => ({ ReminderRepository: class {} }));

const user: Recipient = {
  id: 'user',
  external_id: 'subject',
  email: 'test@example.test',
  display_name: '<Gia & Sĩ>',
  timezone: 'Asia/Ho_Chi_Minh',
  status: 'active',
  email_verified_at: new Date(),
  email_enabled: true,
  learning_enabled: true,
  preferences: {},
};

describe('reminder preferences and templates', () => {
  it('enforces master switch, verification and each category independently', () => {
    expect(permitsEmail(user, 'DEADLINE_24H', 'deadline')).toBe(true);
    expect(permitsEmail({ ...user, email_enabled: false }, 'DEADLINE_24H', 'deadline')).toBe(false);
    expect(permitsEmail({ ...user, email_verified_at: null }, 'DEADLINE_24H', 'deadline')).toBe(
      false,
    );
    expect(
      permitsEmail(
        { ...user, preferences: { deadlineReminders: false } },
        'DEADLINE_24H',
        'deadline',
      ),
    ).toBe(false);
    expect(
      permitsEmail(
        { ...user, preferences: { assignmentNotifications: false } },
        'ASSIGNMENT_ASSIGNED',
        'assignment',
      ),
    ).toBe(false);
    expect(
      permitsEmail({ ...user, learning_enabled: false }, 'LEARNING_REMINDER', 'learning'),
    ).toBe(false);
    expect(
      permitsEmail(
        { ...user, preferences: { workspaceEmailUpdates: false } },
        'WORKSPACE_JOIN_APPROVED',
        'workspace',
      ),
    ).toBe(false);
    expect(
      permitsEmail(
        { ...user, preferences: { systemAnnouncements: false } },
        'SYSTEM_ANNOUNCEMENT',
        'system',
      ),
    ).toBe(false);
  });
  it('requires explicit opt-in for the six-hour reminder', () => {
    expect(permitsEmail(user, 'DEADLINE_6H', 'deadline')).toBe(false);
    expect(
      permitsEmail(
        { ...user, preferences: { deadline6hReminders: true } },
        'DEADLINE_6H',
        'deadline',
      ),
    ).toBe(true);
  });
  it('escapes content, uses the user timezone and links to the correct exercise', () => {
    const email = renderEmail(
      {
        title: 'Deadline',
        message: '<script>alert(1)</script>',
        actionUrl: '/workspace/dsa?tab=exercises&groupExerciseId=1',
        actionLabel: 'Mở bài',
        dueAt: '2026-09-10T13:00:00Z',
      },
      user,
      'https://codementor.cloud',
    );
    expect(email.html).toContain('&lt;Gia &amp; Sĩ&gt;');
    expect(email.html).not.toContain('<script>');
    expect(email.text).toContain('20:00');
    expect(email.text).toContain(
      'https://codementor.cloud/workspace/dsa?tab=exercises&groupExerciseId=1',
    );
  });
  it('rejects off-site CTAs', () => {
    expect(() =>
      renderEmail(
        { title: 'test', message: 'test', actionUrl: '//evil.test', actionLabel: 'Open' },
        user,
        'https://codementor.cloud',
      ),
    ).toThrow();
  });
});

describe('reminder planner', () => {
  const schedule = jest.fn().mockResolvedValue(undefined),
    cancel = jest.fn().mockResolvedValue(undefined);
  const assignment = jest.fn();
  const repo = { schedule, cancel, assignment } as unknown as ReminderRepository;
  const planner = new ReminderPlanner(repo, new ConfigService());
  beforeEach(() => {
    jest.clearAllMocks();
    assignment.mockResolvedValue({
      id: 'a1',
      user_id: 'u1',
      eligible: true,
      completed: false,
      workspace_slug: 'dsa',
      workspace_name: 'Nhóm CTDL',
      exercise_title: 'Binary Search',
      group_id: 'g1',
      group_exercise_id: 'ge1',
      due_at: new Date(Date.now() + 30 * 3600000),
      allow_retry: true,
      review_status: 'pending',
    });
  });
  it('plans assignment plus deadline schedules at creation', async () => {
    await planner.source({
      entityType: 'ASSIGNMENT',
      entityId: 'a1',
      change: 'INSERT',
      changedAt: new Date().toISOString(),
    });
    expect(schedule.mock.calls.map(([v]) => v.type)).toEqual([
      'ASSIGNMENT_ASSIGNED',
      'DEADLINE_24H',
      'DEADLINE_6H',
      'ASSIGNMENT_OVERDUE',
    ]);
    expect(schedule.mock.calls[1][0]).toMatchObject({
      replace: true,
      payload: { referenceId: 'g1' },
    });
  });
  it('cancels all outstanding reminders once the assignment is completed', async () => {
    assignment.mockResolvedValue({ eligible: true, completed: true });
    await planner.source({
      entityType: 'ASSIGNMENT',
      entityId: 'a1',
      change: 'UPDATE',
      changedAt: new Date().toISOString(),
    });
    expect(cancel).toHaveBeenCalledWith('ASSIGNMENT', 'a1');
    expect(schedule).not.toHaveBeenCalled();
  });
  it('queues a bounded retry reminder for unsuccessful attempts', async () => {
    await planner.source({
      entityType: 'SUBMISSION',
      entityId: 'a1',
      change: 'INSERT',
      changedAt: new Date().toISOString(),
      submissionId: 's1',
      verdict: 'wrong_answer',
    });
    expect(schedule).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'RETRY_EXERCISE', version: 's1', replace: true }),
    );
  });
});

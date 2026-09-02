export type EmailCategory = 'assignment' | 'deadline' | 'learning' | 'workspace' | 'system';
export type ReminderType =
  | 'ASSIGNMENT_ASSIGNED'
  | 'DEADLINE_24H'
  | 'DEADLINE_6H'
  | 'ASSIGNMENT_OVERDUE'
  | 'RETRY_EXERCISE'
  | 'DEADLINE_CHANGED'
  | 'WORKSPACE_JOIN_APPROVED'
  | 'WORKSPACE_JOIN_REJECTED'
  | 'WORKSPACE_MEMBER_ADDED'
  | 'WORKSPACE_DOCUMENT_PENDING'
  | 'WORKSPACE_DOCUMENT_PUBLISHED'
  | 'WORKSPACE_DOCUMENT_REJECTED'
  | 'LEARNING_REMINDER'
  | 'STUDY_SESSION_REMINDER'
  | 'COURSE_COMPLETED'
  | 'SYSTEM_ANNOUNCEMENT';
export interface EmailPayload {
  title: string;
  message: string;
  actionUrl: string;
  actionLabel: string;
  dueAt?: string;
  notificationId?: string;
  referenceId?: string;
}
export interface Reminder {
  id: string;
  user_id: string;
  type: ReminderType;
  category: EmailCategory;
  entity_type: string;
  entity_id: string;
  source_version: string | null;
  scheduled_at: Date;
  status: string;
  payload: EmailPayload;
  retry_count: number;
  processing_token: string;
}
export interface Recipient {
  id: string;
  external_id: string | null;
  email: string;
  display_name: string;
  timezone: string;
  status: string;
  email_verified_at: Date | null;
  email_enabled: boolean;
  learning_enabled: boolean;
  workspace_enabled?: boolean;
  preferences: {
    assignmentNotifications?: boolean;
    deadlineReminders?: boolean;
    deadline6hReminders?: boolean;
    workspaceEmailUpdates?: boolean;
    systemAnnouncements?: boolean;
    learningInactivityDays?: number;
  };
}
export function permitsEmail(
  recipient: Recipient,
  type: ReminderType,
  category: EmailCategory,
): boolean {
  if (recipient.status !== 'active' || !recipient.email_enabled || !recipient.email_verified_at)
    return false;
  const p = recipient.preferences;
  if (category === 'assignment') return p.assignmentNotifications !== false;
  if (category === 'deadline')
    return (
      p.deadlineReminders !== false && (type !== 'DEADLINE_6H' || p.deadline6hReminders === true)
    );
  if (category === 'learning') return recipient.learning_enabled;
  if (category === 'workspace') return p.workspaceEmailUpdates !== false;
  return p.systemAnnouncements !== false;
}

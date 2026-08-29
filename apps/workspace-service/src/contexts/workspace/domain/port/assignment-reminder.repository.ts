export type AssignmentReminderKind = 'due_soon' | 'overdue';

export interface AssignmentReminderRecord {
  groupId: string;
  workspaceSlug: string;
  workspaceName: string;
  assignmentId: string;
  exerciseTitle: string;
  memberExternalId: string;
  dueAt: Date;
  kind: AssignmentReminderKind;
}

export interface AssignmentReminderRepository {
  claim(now: Date, dueSoonUntil: Date, overdueSince: Date, limit: number): Promise<AssignmentReminderRecord[]>;
  release(assignmentId: string, kind: AssignmentReminderKind): Promise<void>;
}

export const ASSIGNMENT_REMINDER_REPOSITORY = Symbol('ASSIGNMENT_REMINDER_REPOSITORY');

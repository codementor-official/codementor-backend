import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@codementor/platform';
import type {
  AssignmentReminderKind,
  AssignmentReminderRecord,
  AssignmentReminderRepository,
} from '../domain/port/assignment-reminder.repository';

@Injectable()
export class PrismaAssignmentReminderRepository implements AssignmentReminderRepository {
  constructor(private readonly prisma: PrismaService) {}

  claim(now: Date, dueSoonUntil: Date, overdueSince: Date, limit: number) {
    return this.prisma.$queryRaw<AssignmentReminderRecord[]>(Prisma.sql`
      WITH candidates AS (
        SELECT a.id AS "assignmentId", a.group_id AS "groupId",
               g.slug::text AS "workspaceSlug", g.name AS "workspaceName",
               e.title AS "exerciseTitle", u.external_id AS "memberExternalId",
               ge.due_at AS "dueAt",
               CASE WHEN ge.due_at < ${now} THEN 'overdue' ELSE 'due_soon' END AS kind
        FROM assignments a
        JOIN group_exercises ge ON ge.id = a.group_exercise_id AND ge.group_id = a.group_id
        JOIN study_groups g ON g.id = a.group_id
        JOIN exercises e ON e.id = ge.exercise_id
        JOIN group_members gm ON gm.id = a.member_id AND gm.group_id = a.group_id
        JOIN users u ON u.id = gm.user_id
        LEFT JOIN user_settings settings ON settings.user_id = u.id
        LEFT JOIN assignment_reminder_deliveries sent
          ON sent.assignment_id = a.id
         AND sent.kind = CASE WHEN ge.due_at < ${now} THEN 'overdue' ELSE 'due_soon' END
        WHERE a.status NOT IN ('done', 'late')
          AND gm.status = 'active'
          AND g.status = 'active'
          AND ge.deleted_at IS NULL
          AND ge.due_at IS NOT NULL
          AND u.external_id IS NOT NULL
          AND COALESCE(settings.learning_reminders, true) = true
          AND sent.assignment_id IS NULL
          AND (
            (ge.due_at >= ${now} AND ge.due_at <= ${dueSoonUntil})
            OR (ge.due_at < ${now} AND ge.due_at >= ${overdueSince})
          )
        ORDER BY ge.due_at ASC, a.id ASC
        LIMIT ${limit}
      ), claimed AS (
        INSERT INTO assignment_reminder_deliveries (assignment_id, kind)
        SELECT "assignmentId", kind FROM candidates
        ON CONFLICT (assignment_id, kind) DO NOTHING
        RETURNING assignment_id AS "assignmentId", kind
      )
      SELECT c."groupId", c."workspaceSlug", c."workspaceName", c."assignmentId",
             c."exerciseTitle", c."memberExternalId", c."dueAt", c.kind
      FROM candidates c
      JOIN claimed x ON x."assignmentId" = c."assignmentId" AND x.kind = c.kind
    `);
  }

  async release(assignmentId: string, kind: AssignmentReminderKind) {
    await this.prisma.$executeRaw(Prisma.sql`
      DELETE FROM assignment_reminder_deliveries
      WHERE assignment_id = ${assignmentId}::uuid AND kind = ${kind}
    `);
  }
}

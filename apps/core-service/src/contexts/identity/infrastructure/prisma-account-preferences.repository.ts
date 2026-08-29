import { Injectable } from '@nestjs/common';
import { PrismaService } from '@codementor/platform';
import {
  DEFAULT_LEARNING_PREFERENCES,
  DEFAULT_USER_SETTINGS,
  type StudyScheduleSlot,
  type UserLearningPreferences,
  type UserLearningStats,
  type UserSettings,
} from '../domain/model/account-preferences';
import type {
  AccountPreferencesRepository,
  BookmarkTarget,
  LearningLeaderboardEntry,
  UserBookmark,
} from '../domain/port/account-preferences.repository';

interface SettingsRow {
  emailNotifications: boolean;
  workspaceNotifications: boolean;
  learningReminders: boolean;
  weeklyDigest: boolean;
  publicProfile: boolean;
  showLearningProgress: boolean;
  allowWorkspaceInvites: boolean;
  theme: UserSettings['theme'];
}

interface PreferencesRow {
  learningGoal: string | null;
  careerGoal: string | null;
  currentLevel: UserLearningPreferences['currentLevel'];
  contentPriority: UserLearningPreferences['contentPriority'];
  weeklyStudyHours: number | null;
  interestedFields: string[];
  interestedTechnologies: string[];
  preferredLearningStyle: string[];
  remindersEnabled: boolean;
  reminderTime: string | null;
  adaptiveRecommendations: boolean;
  completedAt: Date | null;
}

@Injectable()
export class PrismaAccountPreferencesRepository implements AccountPreferencesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(userId: string): Promise<UserSettings> {
    const [row] = await this.prisma.$queryRawUnsafe<SettingsRow[]>(
      `SELECT email_notifications AS "emailNotifications",
              workspace_notifications AS "workspaceNotifications",
              learning_reminders AS "learningReminders",
              weekly_digest AS "weeklyDigest",
              public_profile AS "publicProfile",
              show_learning_progress AS "showLearningProgress",
              allow_workspace_invites AS "allowWorkspaceInvites",
              theme
       FROM user_settings WHERE user_id = $1::uuid`,
      userId,
    );
    return row ?? { ...DEFAULT_USER_SETTINGS };
  }

  async saveSettings(userId: string, patch: Partial<UserSettings>): Promise<UserSettings> {
    const next = { ...(await this.getSettings(userId)), ...patch };
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO user_settings
         (user_id, email_notifications, workspace_notifications, learning_reminders,
          weekly_digest, public_profile, show_learning_progress, allow_workspace_invites, theme)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (user_id) DO UPDATE SET
         email_notifications = EXCLUDED.email_notifications,
         workspace_notifications = EXCLUDED.workspace_notifications,
         learning_reminders = EXCLUDED.learning_reminders,
         weekly_digest = EXCLUDED.weekly_digest,
         public_profile = EXCLUDED.public_profile,
         show_learning_progress = EXCLUDED.show_learning_progress,
         allow_workspace_invites = EXCLUDED.allow_workspace_invites,
         theme = EXCLUDED.theme`,
      userId,
      next.emailNotifications,
      next.workspaceNotifications,
      next.learningReminders,
      next.weeklyDigest,
      next.publicProfile,
      next.showLearningProgress,
      next.allowWorkspaceInvites,
      next.theme,
    );
    return next;
  }

  async resetSettings(userId: string): Promise<UserSettings> {
    await this.prisma.$executeRawUnsafe(
      'DELETE FROM user_settings WHERE user_id = $1::uuid',
      userId,
    );
    return { ...DEFAULT_USER_SETTINGS };
  }

  async getPreferences(userId: string): Promise<UserLearningPreferences> {
    const [row] = await this.prisma.$queryRawUnsafe<PreferencesRow[]>(
      `SELECT learning_goal AS "learningGoal", career_goal AS "careerGoal",
              current_level::text AS "currentLevel", content_priority::text AS "contentPriority",
              weekly_study_hours AS "weeklyStudyHours", interested_fields::text[] AS "interestedFields",
              interested_technologies AS "interestedTechnologies",
              preferred_learning_formats AS "preferredLearningStyle",
              reminders_enabled AS "remindersEnabled",
              to_char(reminder_time, 'HH24:MI') AS "reminderTime",
              adaptive_recommendations AS "adaptiveRecommendations", completed_at AS "completedAt"
       FROM learning_preferences WHERE user_id = $1::uuid`,
      userId,
    );
    const schedule = await this.getSchedule(userId);
    if (!row) {
      return {
        ...DEFAULT_LEARNING_PREFERENCES,
        schedule,
        interestedFields: [],
        interestedTechnologies: [],
        preferredLearningStyle: [],
      };
    }
    return {
      ...row,
      interestedFields: (row.interestedFields ?? []).map((field) =>
        field === 'data_ai' ? 'data-ai' : field,
      ),
      interestedTechnologies: row.interestedTechnologies ?? [],
      preferredLearningStyle: row.preferredLearningStyle ?? [],
      reminderTime: row.reminderTime ?? '18:45',
      schedule,
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }

  async savePreferences(
    userId: string,
    patch: Partial<Omit<UserLearningPreferences, 'schedule' | 'completedAt'>> & {
      schedule?: StudyScheduleSlot[];
    },
  ): Promise<UserLearningPreferences> {
    const current = await this.getPreferences(userId);
    const next = { ...current, ...patch };
    const fields = next.interestedFields.map((field) => (field === 'data-ai' ? 'data_ai' : field));

    const statements = [
      this.prisma.$executeRawUnsafe(
        `INSERT INTO learning_preferences
           (user_id, learning_goal, career_goal, current_level, content_priority,
            weekly_study_hours, interested_fields, interested_technologies,
            preferred_learning_formats, reminders_enabled, reminder_time,
            adaptive_recommendations, completed_at)
         VALUES ($1::uuid, $2, $3, $4::current_level, $5::content_priority,
                 $6, $7::roadmap_field[], $8::text[], $9::text[], $10, $11::time, $12, now())
         ON CONFLICT (user_id) DO UPDATE SET
           learning_goal = EXCLUDED.learning_goal,
           career_goal = EXCLUDED.career_goal,
           current_level = EXCLUDED.current_level,
           content_priority = EXCLUDED.content_priority,
           weekly_study_hours = EXCLUDED.weekly_study_hours,
           interested_fields = EXCLUDED.interested_fields,
           interested_technologies = EXCLUDED.interested_technologies,
           preferred_learning_formats = EXCLUDED.preferred_learning_formats,
           reminders_enabled = EXCLUDED.reminders_enabled,
           reminder_time = EXCLUDED.reminder_time,
           adaptive_recommendations = EXCLUDED.adaptive_recommendations,
           completed_at = COALESCE(learning_preferences.completed_at, now())`,
        userId,
        next.learningGoal,
        next.careerGoal,
        next.currentLevel,
        next.contentPriority,
        next.weeklyStudyHours,
        fields,
        next.interestedTechnologies,
        next.preferredLearningStyle,
        next.remindersEnabled,
        next.reminderTime,
        next.adaptiveRecommendations,
      ),
    ];

    if (patch.schedule) {
      for (const slot of patch.schedule) {
        statements.push(
          this.prisma.$executeRawUnsafe(
            `INSERT INTO study_schedule_slots (user_id, weekday, enabled, start_time, duration_minutes)
             VALUES ($1::uuid, $2::weekday, $3, $4::time, $5)
             ON CONFLICT (user_id, weekday) DO UPDATE SET
               enabled = EXCLUDED.enabled,
               start_time = EXCLUDED.start_time,
               duration_minutes = EXCLUDED.duration_minutes`,
            userId,
            slot.weekday,
            slot.enabled,
            slot.startTime,
            slot.durationMinutes,
          ),
        );
      }
    }
    await this.prisma.$transaction(statements);
    return this.getPreferences(userId);
  }

  async getStats(userId: string): Promise<UserLearningStats> {
    const [row] = await this.prisma.$queryRawUnsafe<
      Array<{
        xp: number;
        solvedCount: number;
        currentStreakDays: number;
        longestStreakDays: number;
        lastSolvedOn: Date | null;
      }>
    >(
      `SELECT xp, solved_count AS "solvedCount", current_streak_days AS "currentStreakDays",
              longest_streak_days AS "longestStreakDays", last_solved_on AS "lastSolvedOn"
       FROM user_stats WHERE user_id = $1::uuid`,
      userId,
    );
    return row
      ? { ...row, lastSolvedOn: row.lastSolvedOn?.toISOString().slice(0, 10) ?? null }
      : { xp: 0, solvedCount: 0, currentStreakDays: 0, longestStreakDays: 0, lastSolvedOn: null };
  }

  leaderboard(limit: number): Promise<LearningLeaderboardEntry[]> {
    return this.prisma.$queryRawUnsafe<LearningLeaderboardEntry[]>(
      `SELECT u.id, u.display_name AS "displayName", u.avatar_url AS "avatarUrl",
              COALESCE(s.xp, 0)::int AS xp,
              COALESCE(s.solved_count, 0)::int AS "solvedCount"
       FROM users u
       JOIN user_stats s ON s.user_id = u.id
       WHERE u.status = 'active' AND u.role = 'learner'
       ORDER BY s.xp DESC, s.solved_count DESC, u.id ASC
       LIMIT $1`,
      limit,
    );
  }

  async listBookmarks(
    userId: string,
    input: { targetType?: BookmarkTarget; page: number; limit: number },
  ) {
    const offset = (input.page - 1) * input.limit;
    const typeFilter = input.targetType ? 'AND target_type = $4' : '';
    const params: unknown[] = [userId, input.limit, offset];
    if (input.targetType) params.push(input.targetType);
    const [items, countRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<
        Array<{
          id: string;
          targetType: BookmarkTarget;
          targetId: string;
          targetRef: string | null;
          createdAt: Date;
        }>
      >(
        `SELECT id, target_type AS "targetType", target_id AS "targetId",
                target_ref AS "targetRef", created_at AS "createdAt"
         FROM user_bookmarks
         WHERE user_id = $1::uuid ${typeFilter}
         ORDER BY created_at DESC, id DESC
         LIMIT $2 OFFSET $3`,
        ...params,
      ),
      this.prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
        `SELECT count(*) AS total FROM user_bookmarks
         WHERE user_id = $1::uuid ${input.targetType ? 'AND target_type = $2' : ''}`,
        ...(input.targetType ? [userId, input.targetType] : [userId]),
      ),
    ]);
    return {
      items: items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  async saveBookmark(
    userId: string,
    input: { targetType: BookmarkTarget; targetId: string; targetRef?: string },
  ): Promise<UserBookmark> {
    const [row] = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        targetType: BookmarkTarget;
        targetId: string;
        targetRef: string | null;
        createdAt: Date;
      }>
    >(
      `INSERT INTO user_bookmarks (user_id, target_type, target_id, target_ref)
       VALUES ($1::uuid, $2, $3::uuid, $4)
       ON CONFLICT (user_id, target_type, target_id) DO UPDATE SET
         target_ref = COALESCE(EXCLUDED.target_ref, user_bookmarks.target_ref)
       RETURNING id, target_type AS "targetType", target_id AS "targetId",
                 target_ref AS "targetRef", created_at AS "createdAt"`,
      userId,
      input.targetType,
      input.targetId,
      input.targetRef?.trim() || null,
    );
    return { ...row, createdAt: row.createdAt.toISOString() };
  }

  async removeBookmark(userId: string, targetType: BookmarkTarget, targetId: string) {
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM user_bookmarks
       WHERE user_id = $1::uuid AND target_type = $2 AND target_id = $3::uuid`,
      userId,
      targetType,
      targetId,
    );
  }

  private async getSchedule(userId: string): Promise<StudyScheduleSlot[]> {
    const rows = await this.prisma.$queryRawUnsafe<StudyScheduleSlot[]>(
      `SELECT weekday::text AS weekday, enabled, to_char(start_time, 'HH24:MI') AS "startTime",
              duration_minutes AS "durationMinutes"
       FROM study_schedule_slots WHERE user_id = $1::uuid ORDER BY weekday`,
      userId,
    );
    if (rows.length === 0)
      return DEFAULT_LEARNING_PREFERENCES.schedule.map((slot) => ({ ...slot }));
    const byDay = new Map(rows.map((slot) => [slot.weekday, slot]));
    return DEFAULT_LEARNING_PREFERENCES.schedule.map(
      (fallback) => byDay.get(fallback.weekday) ?? { ...fallback },
    );
  }
}

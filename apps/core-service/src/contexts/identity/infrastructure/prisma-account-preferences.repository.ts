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
  BookmarkSort,
  BookmarkTarget,
  LearningLeaderboardEntry,
  ResolvedUserBookmark,
  UserBookmark,
} from '../domain/port/account-preferences.repository';
import { resolveUserSettings } from '../domain/model/resolve-user-settings';

interface SettingsRow {
  emailPreferences: Partial<UserSettings> | null;
  emailNotifications: boolean | null;
  workspaceNotifications: boolean | null;
  learningReminders: boolean | null;
  weeklyDigest: boolean | null;
  publicProfile: boolean | null;
  showLearningProgress: boolean | null;
  allowWorkspaceInvites: boolean | null;
  theme: UserSettings['theme'] | null;
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
              theme, email_preferences AS "emailPreferences"
       FROM user_settings WHERE user_id = $1::uuid`,
      userId,
    );
    if (!row) return { ...DEFAULT_USER_SETTINGS };
    const { emailPreferences, ...columns } = row;
    return resolveUserSettings(columns, emailPreferences);
  }

  async saveSettings(userId: string, patch: Partial<UserSettings>): Promise<UserSettings> {
    // ValidationPipe can materialize every optional DTO field with `undefined`.
    // A partial PATCH must not let those enumerable fields erase persisted/default values.
    const next = resolveUserSettings(await this.getSettings(userId), patch);
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO user_settings
         (user_id, email_notifications, workspace_notifications, learning_reminders,
          weekly_digest, public_profile, show_learning_progress, allow_workspace_invites, theme, email_preferences)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
       ON CONFLICT (user_id) DO UPDATE SET
         email_notifications = EXCLUDED.email_notifications,
         workspace_notifications = EXCLUDED.workspace_notifications,
         learning_reminders = EXCLUDED.learning_reminders,
         weekly_digest = EXCLUDED.weekly_digest,
         public_profile = EXCLUDED.public_profile,
         show_learning_progress = EXCLUDED.show_learning_progress,
         allow_workspace_invites = EXCLUDED.allow_workspace_invites,
         theme = EXCLUDED.theme,
         email_preferences = EXCLUDED.email_preferences,
         updated_at = now()`,
      userId,
      next.emailNotifications,
      next.workspaceNotifications,
      next.learningReminders,
      next.weeklyDigest,
      next.publicProfile,
      next.showLearningProgress,
      next.allowWorkspaceInvites,
      next.theme,
      JSON.stringify({ assignmentNotifications: next.assignmentNotifications,
        deadlineReminders: next.deadlineReminders, deadline6hReminders: next.deadline6hReminders,
        workspaceEmailUpdates: next.workspaceEmailUpdates, systemAnnouncements: next.systemAnnouncements,
        learningInactivityDays: next.learningInactivityDays, miniChatEnabled: next.miniChatEnabled }),
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
    input: {
      targetType?: BookmarkTarget;
      q?: string;
      sort: BookmarkSort;
      page: number;
      limit: number;
    },
  ) {
    const offset = (input.page - 1) * input.limit;
    const filters = ['b.user_id = $1::uuid'];
    const filterParams: unknown[] = [userId];
    if (input.targetType) {
      filterParams.push(input.targetType);
      filters.push(`b.target_type = $${filterParams.length}`);
    }
    if (input.q) {
      filterParams.push(`%${input.q}%`);
      filters.push(`(
        COALESCE(c.title, r.title, e.title, a.title, '') ILIKE $${filterParams.length}
        OR COALESCE(c.description, r.short_description, r.description, e.summary, a.excerpt, '')
          ILIKE $${filterParams.length}
        OR COALESCE(author.display_name, '') ILIKE $${filterParams.length}
      )`);
    }
    const where = filters.join(' AND ');
    const joins = `
      FROM user_bookmarks b
      LEFT JOIN courses c ON b.target_type = 'COURSE' AND c.id = b.target_id
      LEFT JOIN roadmaps r ON b.target_type = 'ROADMAP' AND r.id = b.target_id
      LEFT JOIN exercises e ON b.target_type = 'EXERCISE' AND e.id = b.target_id
      LEFT JOIN articles a ON b.target_type = 'POST' AND a.id = b.target_id
      LEFT JOIN users author ON author.id = CASE b.target_type
        WHEN 'COURSE' THEN COALESCE(c.instructor_id, c.created_by)
        WHEN 'ROADMAP' THEN r.created_by
        WHEN 'EXERCISE' THEN e.author_id
        WHEN 'POST' THEN a.author_id
      END`;
    const orderBy =
      input.sort === 'oldest'
        ? 'b.created_at ASC, b.id ASC'
        : input.sort === 'title'
          ? `LOWER(COALESCE(c.title, r.title, e.title, a.title, '')) ASC,
             b.created_at DESC, b.id DESC`
          : 'b.created_at DESC, b.id DESC';
    const itemParams = [...filterParams, input.limit, offset];
    const limitPosition = filterParams.length + 1;
    const offsetPosition = filterParams.length + 2;
    const [items, countRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<
        Array<Omit<ResolvedUserBookmark, 'createdAt'> & { createdAt: Date }>
      >(
        `SELECT b.id, b.target_type AS "targetType", b.target_id AS "targetId",
                b.target_ref AS "targetRef", b.created_at AS "createdAt",
                COALESCE(c.slug::text, r.slug::text, e.slug::text, a.slug::text, b.target_ref)
                  AS "contentSlug",
                COALESCE(c.title, r.title, e.title, a.title) AS title,
                COALESCE(c.description, r.short_description, r.description, e.summary, a.excerpt)
                  AS description,
                COALESCE(c.cover_image_url, r.cover_image_url) AS "coverImageUrl",
                author.display_name AS "authorName",
                CASE b.target_type
                  WHEN 'COURSE' THEN c.status::text
                  WHEN 'ROADMAP' THEN r.status::text
                  WHEN 'EXERCISE' THEN e.status::text
                  WHEN 'POST' THEN a.status::text
                END AS "contentStatus",
                CASE b.target_type
                  WHEN 'COURSE' THEN c.id IS NOT NULL AND c.status = 'published'
                  WHEN 'ROADMAP' THEN r.id IS NOT NULL AND r.status = 'published'
                  WHEN 'EXERCISE' THEN e.id IS NOT NULL AND e.status = 'published'
                    AND e.visibility = 'public'
                  WHEN 'POST' THEN a.id IS NOT NULL AND a.status = 'published'
                  ELSE false
                END AS available,
                e.difficulty::text AS difficulty,
                COALESCE(c.level::text, r.level::text) AS level,
                CASE b.target_type
                  WHEN 'COURSE' THEN c.duration_hours * 60
                  WHEN 'ROADMAP' THEN r.estimated_hours * 60
                  WHEN 'EXERCISE' THEN e.estimated_minutes
                  WHEN 'POST' THEN a.read_minutes
                END AS "durationMinutes",
                CASE b.target_type
                  WHEN 'COURSE' THEN c.total_lessons
                  WHEN 'ROADMAP' THEN (
                    SELECT count(*)::int FROM roadmap_courses rc WHERE rc.roadmap_id = r.id
                  )
                END AS "itemCount",
                CASE b.target_type
                  WHEN 'COURSE' THEN c.enrollment_count
                  WHEN 'ROADMAP' THEN r.popularity_score
                  WHEN 'EXERCISE' THEN e.solver_count
                END AS popularity
         ${joins}
         WHERE ${where}
         ORDER BY ${orderBy}
         LIMIT $${limitPosition} OFFSET $${offsetPosition}`,
        ...itemParams,
      ),
      this.prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
        `SELECT count(*) AS total ${joins} WHERE ${where}`,
        ...filterParams,
      ),
    ]);
    return {
      items: items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  async hasBookmark(userId: string, targetType: BookmarkTarget, targetId: string) {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ saved: boolean }>>(
      `SELECT EXISTS(
         SELECT 1 FROM user_bookmarks
         WHERE user_id = $1::uuid AND target_type = $2 AND target_id = $3::uuid
       ) AS saved`,
      userId,
      targetType,
      targetId,
    );
    return rows[0]?.saved ?? false;
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

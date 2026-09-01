import type {
  StudyScheduleSlot,
  UserLearningPreferences,
  UserLearningStats,
  UserSettings,
} from '../model/account-preferences';

export type BookmarkTarget = 'COURSE' | 'ROADMAP' | 'EXERCISE' | 'POST';
export type BookmarkSort = 'newest' | 'oldest' | 'title';
export interface UserBookmark {
  id: string;
  targetType: BookmarkTarget;
  targetId: string;
  targetRef: string | null;
  createdAt: string;
}
export interface ResolvedUserBookmark extends UserBookmark {
  contentSlug: string | null;
  title: string | null;
  description: string | null;
  coverImageUrl: string | null;
  authorName: string | null;
  contentStatus: string | null;
  available: boolean;
  difficulty: string | null;
  level: string | null;
  durationMinutes: number | null;
  itemCount: number | null;
  popularity: number | null;
}

export interface LearningLeaderboardEntry {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  xp: number;
  solvedCount: number;
}

export interface AccountPreferencesRepository {
  getSettings(userId: string): Promise<UserSettings>;
  saveSettings(userId: string, patch: Partial<UserSettings>): Promise<UserSettings>;
  resetSettings(userId: string): Promise<UserSettings>;
  getPreferences(userId: string): Promise<UserLearningPreferences>;
  savePreferences(
    userId: string,
    patch: Partial<Omit<UserLearningPreferences, 'schedule' | 'completedAt'>> & {
      schedule?: StudyScheduleSlot[];
    },
  ): Promise<UserLearningPreferences>;
  getStats(userId: string): Promise<UserLearningStats>;
  leaderboard(limit: number): Promise<LearningLeaderboardEntry[]>;
  listBookmarks(
    userId: string,
    input: {
      targetType?: BookmarkTarget;
      q?: string;
      sort: BookmarkSort;
      page: number;
      limit: number;
    },
  ): Promise<{ items: ResolvedUserBookmark[]; total: number }>;
  hasBookmark(userId: string, targetType: BookmarkTarget, targetId: string): Promise<boolean>;
  saveBookmark(
    userId: string,
    input: { targetType: BookmarkTarget; targetId: string; targetRef?: string },
  ): Promise<UserBookmark>;
  removeBookmark(userId: string, targetType: BookmarkTarget, targetId: string): Promise<void>;
}

export const ACCOUNT_PREFERENCES_REPOSITORY = Symbol('ACCOUNT_PREFERENCES_REPOSITORY');

import { Inject, Injectable } from '@nestjs/common';
import type {
  StudyScheduleSlot,
  UserLearningPreferences,
  UserLearningStats,
  UserSettings,
} from '../domain/model/account-preferences';
import {
  ACCOUNT_PREFERENCES_REPOSITORY,
  type AccountPreferencesRepository,
  type BookmarkSort,
  type BookmarkTarget,
} from '../domain/port/account-preferences.repository';

@Injectable()
export class AccountPreferencesService {
  constructor(
    @Inject(ACCOUNT_PREFERENCES_REPOSITORY)
    private readonly repository: AccountPreferencesRepository,
  ) {}

  getSettings(userId: string): Promise<UserSettings> {
    return this.repository.getSettings(userId);
  }

  updateSettings(userId: string, patch: Partial<UserSettings>): Promise<UserSettings> {
    return this.repository.saveSettings(userId, patch);
  }

  resetSettings(userId: string): Promise<UserSettings> {
    return this.repository.resetSettings(userId);
  }

  getPreferences(userId: string): Promise<UserLearningPreferences> {
    return this.repository.getPreferences(userId);
  }

  updatePreferences(
    userId: string,
    patch: Partial<Omit<UserLearningPreferences, 'schedule' | 'completedAt'>> & {
      schedule?: StudyScheduleSlot[];
    },
  ): Promise<UserLearningPreferences> {
    return this.repository.savePreferences(userId, patch);
  }

  getStats(userId: string): Promise<UserLearningStats> {
    return this.repository.getStats(userId);
  }

  leaderboard(limit = 5) {
    return this.repository.leaderboard(Math.min(Math.max(limit, 1), 20));
  }

  async bookmarks(
    userId: string,
    input: {
      targetType?: BookmarkTarget;
      q?: string;
      sort?: BookmarkSort;
      page: number;
      limit: number;
    },
  ) {
    const safePage = Math.max(input.page, 1);
    const safeLimit = Math.min(Math.max(input.limit, 1), 100);
    const result = await this.repository.listBookmarks(userId, {
      targetType: input.targetType,
      q: input.q?.trim() || undefined,
      sort: input.sort ?? 'newest',
      page: safePage,
      limit: safeLimit,
    });
    return {
      ...result,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(result.total / safeLimit),
    };
  }

  async bookmarkStatus(userId: string, targetType: BookmarkTarget, targetId: string) {
    return { saved: await this.repository.hasBookmark(userId, targetType, targetId) };
  }

  saveBookmark(
    userId: string,
    input: { targetType: BookmarkTarget; targetId: string; targetRef?: string },
  ) {
    return this.repository.saveBookmark(userId, input);
  }

  removeBookmark(userId: string, targetType: BookmarkTarget, targetId: string) {
    return this.repository.removeBookmark(userId, targetType, targetId);
  }
}

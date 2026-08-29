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
    targetType: BookmarkTarget | undefined,
    page: number,
    limit: number,
  ) {
    const safePage = Math.max(page, 1);
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const result = await this.repository.listBookmarks(userId, {
      targetType,
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

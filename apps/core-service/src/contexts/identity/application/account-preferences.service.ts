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
}

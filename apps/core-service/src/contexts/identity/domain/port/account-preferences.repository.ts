import type {
  StudyScheduleSlot,
  UserLearningPreferences,
  UserLearningStats,
  UserSettings,
} from '../model/account-preferences';

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
}

export const ACCOUNT_PREFERENCES_REPOSITORY = Symbol('ACCOUNT_PREFERENCES_REPOSITORY');

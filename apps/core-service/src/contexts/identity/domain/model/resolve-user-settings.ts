import { DEFAULT_USER_SETTINGS, type UserSettings } from './account-preferences';

/** Merge persisted values and PATCH DTOs without letting null/undefined erase safe defaults. */
export function resolveUserSettings(
  ...sources: Array<Partial<Record<keyof UserSettings, unknown>> | null | undefined>
): UserSettings {
  const resolved: Record<string, unknown> = { ...DEFAULT_USER_SETTINGS };
  for (const source of sources) {
    for (const [key, value] of Object.entries(source ?? {})) {
      if (value !== null && value !== undefined) resolved[key] = value;
    }
  }
  return resolved as unknown as UserSettings;
}

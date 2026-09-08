import { resolveUserSettings } from './resolve-user-settings';

describe('resolveUserSettings', () => {
  it('keeps defaults when an optional PATCH property is enumerable but undefined', () => {
    const result = resolveUserSettings({
      emailNotifications: undefined,
      miniChatEnabled: false,
    });

    expect(result.emailNotifications).toBe(true);
    expect(result.workspaceNotifications).toBe(true);
    expect(result.miniChatEnabled).toBe(false);
  });

  it('repairs nullable legacy values while preserving valid stored settings', () => {
    const result = resolveUserSettings({
      emailNotifications: null,
      theme: 'dark',
    });

    expect(result.emailNotifications).toBe(true);
    expect(result.theme).toBe('dark');
  });
});

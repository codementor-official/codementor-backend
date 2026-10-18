import { roleChangeBlocker, statusChangeBlocker } from './account-change-rules';

const base = {
  selfChange: false,
  currentRole: 'learner',
  currentStatus: 'active',
  activeAdmins: 2,
};

describe('roleChangeBlocker', () => {
  it('allows promoting an active learner', () =>
    expect(roleChangeBlocker({ ...base, nextRole: 'lecturer' })).toBeNull());
  it('refuses changing your own role', () =>
    expect(roleChangeBlocker({ ...base, selfChange: true, nextRole: 'admin' })).toMatch(
      /chính mình/,
    ));
  it('refuses a suspended account', () =>
    expect(
      roleChangeBlocker({ ...base, currentStatus: 'suspended', nextRole: 'lecturer' }),
    ).toMatch(/mở khoá/));
  it('refuses a no-op', () =>
    expect(roleChangeBlocker({ ...base, nextRole: 'learner' })).toMatch(/đã có/));
  it('keeps the last admin', () =>
    expect(
      roleChangeBlocker({ ...base, currentRole: 'admin', activeAdmins: 1, nextRole: 'learner' }),
    ).toMatch(/cuối cùng/));
  it('lets one of two admins step down', () =>
    expect(roleChangeBlocker({ ...base, currentRole: 'admin', nextRole: 'lecturer' })).toBeNull());
});

describe('statusChangeBlocker', () => {
  it('allows suspending another active learner', () =>
    expect(statusChangeBlocker({ ...base, suspend: true })).toBeNull());
  it('refuses self', () =>
    expect(statusChangeBlocker({ ...base, selfChange: true, suspend: true })).toMatch(
      /chính mình/,
    ));
  it('refuses suspending the last admin', () =>
    expect(
      statusChangeBlocker({ ...base, currentRole: 'admin', activeAdmins: 1, suspend: true }),
    ).toMatch(/cuối cùng/));
  it('refuses unlocking an active account', () =>
    expect(statusChangeBlocker({ ...base, suspend: false })).toMatch(/đang hoạt động/));
});

import {
  formatBytes,
  groupSlotProblem,
  memberSeatProblem,
  transferProblems,
  uploadProblem,
  usageLevel,
  type OwnerEntitlements,
} from './workspace-quota';

const MB = 1024 ** 2;
const free: OwnerEntitlements = { source: 'free', planName: 'Free', maxOwnedGroups: 1, maxMembersPerGroup: 10, maxStorageBytes: 100 * MB, maxUploadBytes: 10 * MB };
const pro: OwnerEntitlements = { ...free, source: 'paid', planName: 'Pro', maxOwnedGroups: 20, maxMembersPerGroup: null, maxStorageBytes: 20 * 1024 * MB, maxUploadBytes: 250 * MB };
const empty = { ownedGroups: 0, storedBytes: 0, reservedBytes: 0 };

describe('groupSlotProblem', () => {
  it('allows the last slot and refuses the next', () => {
    expect(groupSlotProblem(free, empty)).toBeNull();
    expect(groupSlotProblem(free, { ...empty, ownedGroups: 1 })?.code).toBe('WORKSPACE_GROUP_LIMIT_REACHED');
  });
  it('refuses new groups while over the limit after a downgrade', () => {
    const problem = groupSlotProblem(free, { ...empty, ownedGroups: 15 });
    expect(problem?.message).toBe('Your Free plan allows 1 study group, and you own 15.');
  });
});

describe('memberSeatProblem', () => {
  it('counts the owner and stops at the limit', () => {
    expect(memberSeatProblem(free, 9)).toBeNull();
    expect(memberSeatProblem(free, 10)?.code).toBe('WORKSPACE_MEMBER_LIMIT_REACHED');
  });
  it('never limits an unlimited plan', () => {
    expect(memberSeatProblem(pro, 5000)).toBeNull();
  });
});

describe('uploadProblem', () => {
  it('checks the per-file limit first', () => {
    expect(uploadProblem(free, empty, 11 * MB)?.code).toBe('WORKSPACE_FILE_SIZE_EXCEEDED');
  });
  it('counts stored and reserved bytes against total storage', () => {
    const usage = { ownedGroups: 1, storedBytes: 60 * MB, reservedBytes: 35 * MB };
    expect(uploadProblem(free, usage, 5 * MB)).toBeNull();
    const problem = uploadProblem(free, usage, 6 * MB);
    expect(problem?.code).toBe('WORKSPACE_STORAGE_LIMIT_REACHED');
    expect(problem?.details.available).toBe(5 * MB);
  });
  it('rejects a file that fits the per-file limit but not the remaining space', () => {
    expect(uploadProblem(pro, { ...empty, storedBytes: 20 * 1024 * MB - 50 * MB }, 100 * MB)?.code).toBe('WORKSPACE_STORAGE_LIMIT_REACHED');
  });
});

describe('transferProblems', () => {
  it('lists every constraint the new owner fails', () => {
    const problems = transferProblems(free, { ownedGroups: 1, storedBytes: 90 * MB, reservedBytes: 0 }, { members: 12, storedBytes: 20 * MB });
    expect(problems.map((p) => p.code)).toEqual([
      'WORKSPACE_GROUP_LIMIT_REACHED',
      'WORKSPACE_MEMBER_LIMIT_REACHED',
      'WORKSPACE_STORAGE_LIMIT_REACHED',
    ]);
  });
  it('accepts a group that fits', () => {
    expect(transferProblems(pro, empty, { members: 500, storedBytes: 5 * MB })).toEqual([]);
  });
});

describe('usageLevel', () => {
  it('maps the 70/85/100 thresholds', () => {
    expect(usageLevel(69, 100)).toBe('ok');
    expect(usageLevel(70, 100)).toBe('info');
    expect(usageLevel(85, 100)).toBe('warning');
    expect(usageLevel(100, 100)).toBe('reached');
    expect(usageLevel(150, 100)).toBe('reached');
    expect(usageLevel(10_000, null)).toBe('ok');
  });
});

describe('formatBytes', () => {
  it('formats binary units', () => {
    expect(formatBytes(100 * MB)).toBe('100 MB');
    expect(formatBytes(1.5 * 1024 * MB)).toBe('1.5 GB');
    expect(formatBytes(512)).toBe('512 B');
  });
});

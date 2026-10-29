import { QuotaExceeded } from '@codementor/kernel';

/**
 * Workspace plan limits. Pure decisions over a snapshot read inside the same transaction that
 * consumes the quota — the caller holds the lock, this module only says yes or why not.
 */
export interface OwnerEntitlements {
  source: 'free' | 'paid' | 'grace';
  planName: string;
  maxOwnedGroups: number;
  /** `null` = unlimited under the fair-use policy. */
  maxMembersPerGroup: number | null;
  maxStorageBytes: number;
  maxUploadBytes: number;
}

export interface OwnerUsage {
  ownedGroups: number;
  storedBytes: number;
  reservedBytes: number;
}

export const QUOTA_CODES = {
  groups: 'WORKSPACE_GROUP_LIMIT_REACHED',
  members: 'WORKSPACE_MEMBER_LIMIT_REACHED',
  storage: 'WORKSPACE_STORAGE_LIMIT_REACHED',
  fileSize: 'WORKSPACE_FILE_SIZE_EXCEEDED',
  unavailable: 'WORKSPACE_ENTITLEMENT_UNAVAILABLE',
} as const;

export interface QuotaProblem {
  code: (typeof QUOTA_CODES)[keyof typeof QUOTA_CODES];
  message: string;
  details: Record<string, unknown>;
}

export function groupSlotProblem(e: OwnerEntitlements, u: OwnerUsage): QuotaProblem | null {
  if (u.ownedGroups < e.maxOwnedGroups) return null;
  return {
    code: QUOTA_CODES.groups,
    message: `Your ${e.planName} plan allows ${e.maxOwnedGroups} study group${e.maxOwnedGroups === 1 ? '' : 's'}, and you own ${u.ownedGroups}.`,
    details: { limit: e.maxOwnedGroups, used: u.ownedGroups, plan: e.planName },
  };
}

/** `members` counts active members, owner included. */
export function memberSeatProblem(e: OwnerEntitlements, members: number): QuotaProblem | null {
  if (e.maxMembersPerGroup === null || members < e.maxMembersPerGroup) return null;
  return {
    code: QUOTA_CODES.members,
    message: `This group has reached its maximum of ${e.maxMembersPerGroup} members.`,
    details: { limit: e.maxMembersPerGroup, used: members, plan: e.planName },
  };
}

/** A new upload must fit both the per-file limit and what is left of total storage. */
export function uploadProblem(e: OwnerEntitlements, u: OwnerUsage, sizeBytes: number): QuotaProblem | null {
  if (sizeBytes > e.maxUploadBytes)
    return {
      code: QUOTA_CODES.fileSize,
      message: `This file is ${formatBytes(sizeBytes)}; your ${e.planName} plan accepts files up to ${formatBytes(e.maxUploadBytes)}.`,
      details: { limit: e.maxUploadBytes, requested: sizeBytes, plan: e.planName },
    };
  const used = u.storedBytes + u.reservedBytes;
  if (used + sizeBytes <= e.maxStorageBytes) return null;
  return {
    code: QUOTA_CODES.storage,
    message: `You've used ${formatBytes(used)} of your ${formatBytes(e.maxStorageBytes)} workspace storage; this file needs ${formatBytes(sizeBytes)}.`,
    details: { limit: e.maxStorageBytes, used, requested: sizeBytes, available: Math.max(0, e.maxStorageBytes - used), plan: e.planName },
  };
}

/**
 * Taking over a group needs a free group slot, room for its members and its stored bytes.
 * Returns every problem so the owner sees all of them at once.
 */
export function transferProblems(
  e: OwnerEntitlements,
  u: OwnerUsage,
  group: { members: number; storedBytes: number },
): QuotaProblem[] {
  const problems: QuotaProblem[] = [];
  const slot = groupSlotProblem(e, u);
  if (slot) problems.push({ ...slot, message: `The new owner's ${e.planName} plan has no free study group slot.` });
  if (e.maxMembersPerGroup !== null && group.members > e.maxMembersPerGroup)
    problems.push({
      code: QUOTA_CODES.members,
      message: `This group has ${group.members} members; the new owner's plan allows ${e.maxMembersPerGroup} per group.`,
      details: { limit: e.maxMembersPerGroup, used: group.members, plan: e.planName },
    });
  const used = u.storedBytes + u.reservedBytes;
  if (used + group.storedBytes > e.maxStorageBytes)
    problems.push({
      code: QUOTA_CODES.storage,
      message: `This group stores ${formatBytes(group.storedBytes)}; the new owner has ${formatBytes(Math.max(0, e.maxStorageBytes - used))} left.`,
      details: { limit: e.maxStorageBytes, used, requested: group.storedBytes, plan: e.planName },
    });
  return problems;
}

export type UsageLevel = 'ok' | 'info' | 'warning' | 'reached';

/** 70% informs, 85% warns, 100% is reached. Unlimited is always ok. */
export function usageLevel(used: number, limit: number | null): UsageLevel {
  if (limit === null) return 'ok';
  if (limit === 0) return used > 0 ? 'reached' : 'ok';
  const ratio = used / limit;
  return ratio >= 1 ? 'reached' : ratio >= 0.85 ? 'warning' : ratio >= 0.7 ? 'info' : 'ok';
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${units[unit]}`;
}

/** Turns a refusal into the error the HTTP layer maps to 422 with its specific code. */
export function assertWithinQuota(problem: QuotaProblem | null): void {
  if (problem) throw new QuotaExceeded(problem.code, problem.message, problem.details);
}

export function assertTransferable(problems: QuotaProblem[]): void {
  if (problems.length)
    throw new QuotaExceeded(problems[0].code, problems.map((p) => p.message).join(' '), { problems });
}

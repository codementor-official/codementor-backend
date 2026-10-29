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
  monthlyAiRequests: number;
  features: string[];
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
  ai: 'WORKSPACE_AI_LIMIT_REACHED',
  unavailable: 'WORKSPACE_ENTITLEMENT_UNAVAILABLE',
  readOnly: 'WORKSPACE_GROUP_READ_ONLY',
  hidden: 'WORKSPACE_GROUP_HIDDEN',
  feature: 'WORKSPACE_FEATURE_LOCKED',
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
    message: `Gói ${e.planName} cho phép sở hữu ${e.maxOwnedGroups} nhóm học tập, bạn đang sở hữu ${u.ownedGroups} nhóm.`,
    details: { limit: e.maxOwnedGroups, used: u.ownedGroups, plan: e.planName },
  };
}

/** `members` counts active members, owner included. */
export function memberSeatProblem(e: OwnerEntitlements, members: number): QuotaProblem | null {
  if (e.maxMembersPerGroup === null || members < e.maxMembersPerGroup) return null;
  return {
    code: QUOTA_CODES.members,
    message: `Nhóm đã đạt tối đa ${e.maxMembersPerGroup} thành viên.`,
    details: { limit: e.maxMembersPerGroup, used: members, plan: e.planName },
  };
}

/** A new upload must fit both the per-file limit and what is left of total storage. */
export function uploadProblem(e: OwnerEntitlements, u: OwnerUsage, sizeBytes: number): QuotaProblem | null {
  if (sizeBytes > e.maxUploadBytes)
    return {
      code: QUOTA_CODES.fileSize,
      message: `Tệp nặng ${formatBytes(sizeBytes)}, vượt giới hạn ${formatBytes(e.maxUploadBytes)} mỗi tệp của gói ${e.planName}.`,
      details: { limit: e.maxUploadBytes, requested: sizeBytes, plan: e.planName },
    };
  const used = u.storedBytes + u.reservedBytes;
  if (used + sizeBytes <= e.maxStorageBytes) return null;
  return {
    code: QUOTA_CODES.storage,
    message: `Workspace đã dùng ${formatBytes(used)} / ${formatBytes(e.maxStorageBytes)}; tệp này cần thêm ${formatBytes(sizeBytes)}.`,
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
  if (slot) problems.push({ ...slot, message: `Gói ${e.planName} của người nhận đã hết lượt sở hữu nhóm.` });
  if (e.maxMembersPerGroup !== null && group.members > e.maxMembersPerGroup)
    problems.push({
      code: QUOTA_CODES.members,
      message: `Nhóm có ${group.members} thành viên, gói của người nhận chỉ cho phép ${e.maxMembersPerGroup} thành viên mỗi nhóm.`,
      details: { limit: e.maxMembersPerGroup, used: group.members, plan: e.planName },
    });
  const used = u.storedBytes + u.reservedBytes;
  if (used + group.storedBytes > e.maxStorageBytes)
    problems.push({
      code: QUOTA_CODES.storage,
      message: `Nhóm đang lưu ${formatBytes(group.storedBytes)}, người nhận chỉ còn ${formatBytes(Math.max(0, e.maxStorageBytes - used))} dung lượng.`,
      details: { limit: e.maxStorageBytes, used, requested: group.storedBytes, plan: e.planName },
    });
  return problems;
}

/** Refusal for an AI request; the counter itself is consumed atomically in SQL. */
export function aiProblem(e: OwnerEntitlements, used: number): QuotaProblem {
  return {
    code: QUOTA_CODES.ai,
    message: `Nhóm đã dùng hết ${e.monthlyAiRequests} lượt hỏi AI tài liệu của tháng này theo gói ${e.planName}.`,
    details: { limit: e.monthlyAiRequests, used, plan: e.planName },
  };
}

/** Group features sold by plan; the keys match `workspace_plan_versions.features`. */
export const GROUP_FEATURES = {
  advanced_assignments: 'Quản lý bài tập nâng cao',
  detailed_analytics: 'Thống kê nhóm chi tiết',
} as const;
export type GroupFeature = keyof typeof GROUP_FEATURES;

export function assertFeature(plan: { name: string; features: string[] }, feature: GroupFeature): void {
  if (plan.features.includes(feature)) return;
  throw new QuotaExceeded(
    QUOTA_CODES.feature,
    `${GROUP_FEATURES[feature]} không có trong gói ${plan.name} của chủ nhóm. Chủ nhóm nâng cấp gói để dùng tính năng này.`,
    { feature, plan: plan.name },
  );
}

export type OverageReason = 'groups' | 'members' | 'storage';
export type OverageStage = 'notice' | 'read_only' | 'hidden';

export interface LimitedGroup {
  id: string;
  status: 'active' | 'archived';
  memberCount: number;
  lastActivityAt: Date;
}

/**
 * The groups above the owner's plan, with why. Storage is shared by every owned group, so excess
 * bytes hold all of them; past the group allowance the most recently active groups stay open
 * (archived groups come last: nobody is using them).
 */
export function overLimitGroups(e: OwnerEntitlements, u: OwnerUsage, groups: LimitedGroup[]): Map<string, OverageReason[]> {
  const result = new Map<string, OverageReason[]>();
  const add = (id: string, reason: OverageReason) => result.set(id, [...(result.get(id) ?? []), reason]);
  [...groups]
    .sort(
      (a, b) =>
        Number(a.status === 'archived') - Number(b.status === 'archived') ||
        b.lastActivityAt.getTime() - a.lastActivityAt.getTime() ||
        a.id.localeCompare(b.id),
    )
    .slice(e.maxOwnedGroups)
    .forEach((g) => add(g.id, 'groups'));
  for (const g of groups) {
    if (e.maxMembersPerGroup !== null && g.memberCount > e.maxMembersPerGroup) add(g.id, 'members');
    if (u.storedBytes > e.maxStorageBytes) add(g.id, 'storage');
  }
  return result;
}

export interface OveragePolicy {
  noticeDays: number;
  readOnlyDays: number;
}

const DAY_MS = 86_400_000;

/** Notice first, then read-only, then hidden from members. Nothing is ever deleted. */
export function overageTimeline(overSince: Date, policy: OveragePolicy, now = new Date()) {
  const readOnlyAt = new Date(overSince.getTime() + policy.noticeDays * DAY_MS);
  const hiddenAt = new Date(readOnlyAt.getTime() + policy.readOnlyDays * DAY_MS);
  const stage: OverageStage = now < readOnlyAt ? 'notice' : now < hiddenAt ? 'read_only' : 'hidden';
  return { stage, overSince, readOnlyAt, hiddenAt };
}

export type GroupRestriction = ReturnType<typeof overageTimeline> & { reasons: OverageReason[] };

const REASON_TEXT: Record<OverageReason, string> = {
  groups: 'chủ nhóm sở hữu nhiều nhóm hơn gói cho phép',
  members: 'nhóm có nhiều thành viên hơn gói cho phép',
  storage: 'dung lượng tài liệu vượt hạn mức gói',
};

export function restrictionMessage(r: GroupRestriction): string {
  const why = r.reasons.map((reason) => REASON_TEXT[reason]).join(', ');
  return r.stage === 'hidden'
    ? `Nhóm đang tạm ẩn vì ${why}. Dữ liệu vẫn được giữ nguyên; nhóm mở lại ngay khi chủ nhóm nâng cấp hoặc dọn dẹp.`
    : `Nhóm đang ở chế độ chỉ đọc vì ${why}. Mọi người vẫn xem, tải tài liệu và làm bài đã giao; chủ nhóm nâng cấp hoặc dọn dẹp để mở lại.`;
}

/** Read-only and hidden groups take nothing new: no uploads, exercises, assignments or messages. */
export function assertWritable(r: GroupRestriction | null): void {
  if (!r || r.stage === 'notice') return;
  throw new QuotaExceeded(r.stage === 'hidden' ? QUOTA_CODES.hidden : QUOTA_CODES.readOnly, restrictionMessage(r), {
    reasons: r.reasons,
    stage: r.stage,
    hiddenAt: r.hiddenAt,
  });
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

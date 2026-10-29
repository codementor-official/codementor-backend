import type { OveragePolicy, OwnerEntitlements, OwnerUsage } from '../model/workspace-quota';

export interface QuotaSnapshot {
  entitlements: OwnerEntitlements;
  usage: OwnerUsage;
}

export interface OwnedGroupUsage {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'archived';
  memberCount: number;
  storedBytes: number;
  /** Last activity, or creation for a group nobody has used yet. */
  lastActivityAt: Date;
}

/** Throws to refuse; runs inside the transaction that holds the quota lock. */
export type QuotaGuard = (snapshot: QuotaSnapshot) => void;
export type SeatGuard = (entitlements: OwnerEntitlements, activeMembers: number) => void;
export type TransferGuard = (snapshot: QuotaSnapshot, group: { members: number; storedBytes: number }) => void;

export interface TransferOffer {
  id: string;
  groupId: string;
  fromUserId: string;
  toUserId: string;
  toMembershipId: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  expiresAt: Date;
  createdAt: Date;
}

export const WORKSPACE_QUOTA_REPOSITORY = Symbol('WORKSPACE_QUOTA_REPOSITORY');

/**
 * Quota reads and every operation that consumes a quota. Each write takes an advisory lock
 * (`ws-owner:<id>` or `ws-group:<id>`) so concurrent requests cannot share the last unit.
 */
export interface WorkspaceQuotaRepository {
  snapshot(ownerId: string): Promise<QuotaSnapshot>;
  ownedGroups(ownerId: string): Promise<OwnedGroupUsage[]>;
  /** Since when the owner has been above their plan, with the policy that applies; null when within it. */
  overage(ownerId: string): Promise<{ overSince: Date; policy: OveragePolicy } | null>;
  /** Every user who owns a group or is still marked over the limit. */
  groupOwners(): Promise<string[]>;
  /** Starts the clock the first time an owner is seen over, clears it once they are within. */
  markOverage(ownerId: string, over: boolean): Promise<void>;
  /** Activates (or re-activates) a membership if the group's owner has a free seat. */
  admitMember(groupId: string, userId: string, guard: SeatGuard): Promise<string>;
  reserveUpload(input: {
    ownerId: string;
    groupId: string;
    objectKey: string;
    bytes: number;
    expiresAt: Date;
    guard: QuotaGuard;
  }): Promise<void>;
  /**
   * Charges one AI request to the owner's month (Vietnam time), or reports the allowance as used
   * up. Never counts past the limit, even under concurrent requests.
   */
  consumeAiRequest(ownerId: string): Promise<{ used: number } | { refused: { limit: number; used: number } }>;
  aiRequestsThisMonth(ownerId: string): Promise<number>;
  /** Replaces any pending offer for the group. */
  offerOwnership(input: { groupId: string; fromUserId: string; toUserId: string; toMembershipId: string }): Promise<TransferOffer>;
  pendingOffer(groupId: string): Promise<TransferOffer | null>;
  offersFor(userId: string): Promise<(TransferOffer & { groupSlug: string; groupName: string; fromName: string })[]>;
  closeOffer(id: string, status: 'declined' | 'cancelled'): Promise<boolean>;
  /** Accepts a pending offer: re-checks the group and the recipient's quotas, then transfers. */
  acceptOffer(id: string, recipientId: string, guard: TransferGuard): Promise<TransferOffer>;
  /** Reservations whose upload was never confirmed, oldest first. */
  expiredReservations(limit: number): Promise<{ id: string; objectKey: string }[]>;
  deleteReservation(id: string): Promise<void>;
  isDocumentKeyInUse(objectKey: string): Promise<boolean>;
}

import type { OwnerEntitlements, OwnerUsage } from '../model/workspace-quota';

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
}

/** Throws to refuse; runs inside the transaction that holds the quota lock. */
export type QuotaGuard = (snapshot: QuotaSnapshot) => void;
export type SeatGuard = (entitlements: OwnerEntitlements, activeMembers: number) => void;
export type TransferGuard = (snapshot: QuotaSnapshot, group: { members: number; storedBytes: number }) => void;

export const WORKSPACE_QUOTA_REPOSITORY = Symbol('WORKSPACE_QUOTA_REPOSITORY');

/**
 * Quota reads and every operation that consumes a quota. Each write takes an advisory lock
 * (`ws-owner:<id>` or `ws-group:<id>`) so concurrent requests cannot share the last unit.
 */
export interface WorkspaceQuotaRepository {
  snapshot(ownerId: string): Promise<QuotaSnapshot>;
  ownedGroups(ownerId: string): Promise<OwnedGroupUsage[]>;
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
  transferOwnership(input: {
    groupId: string;
    oldOwnerId: string;
    newOwnerMembershipId: string;
    newOwnerId: string;
    guard: TransferGuard;
  }): Promise<void>;
  /** Reservations whose upload was never confirmed, oldest first. */
  expiredReservations(limit: number): Promise<{ id: string; objectKey: string }[]>;
  deleteReservation(id: string): Promise<void>;
  isDocumentKeyInUse(objectKey: string): Promise<boolean>;
}

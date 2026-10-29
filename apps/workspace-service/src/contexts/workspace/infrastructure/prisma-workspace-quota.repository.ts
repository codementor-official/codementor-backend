import { Injectable } from '@nestjs/common';
import { group_role, member_status, type Prisma } from '@prisma/client';
import { QuotaExceeded } from '@codementor/kernel';
import { PrismaService } from '@codementor/platform';
import { QUOTA_CODES, type OwnerEntitlements, type OwnerUsage } from '../domain/model/workspace-quota';
import type {
  OwnedGroupUsage,
  QuotaGuard,
  QuotaSnapshot,
  SeatGuard,
  TransferGuard,
  WorkspaceQuotaRepository,
} from '../domain/port/workspace-quota.repository';

type Db = Prisma.TransactionClient;

/** Same key space as learning-service: hashtextextended(key, 0). */
async function lock(tx: Db, key: string) {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

/** Entitlements come from the billing read contract, evaluated in this transaction. */
export async function readEntitlements(db: Db, ownerId: string): Promise<OwnerEntitlements> {
  const [row] = await db.$queryRaw<
    {
      source: 'free' | 'paid' | 'grace';
      plan_name: string;
      max_owned_groups: number;
      max_members_per_group: number | null;
      max_storage_bytes: bigint;
      max_upload_bytes: bigint;
    }[]
  >`SELECT source, plan_name, max_owned_groups, max_members_per_group, max_storage_bytes, max_upload_bytes
    FROM workspace_effective_entitlements(${ownerId}::uuid)`;
  // No configured default plan: refuse to consume quota rather than guess a limit.
  if (!row) throw new QuotaExceeded(QUOTA_CODES.unavailable, 'Workspace plans are not available right now. Try again later.');
  return {
    source: row.source,
    planName: row.plan_name,
    maxOwnedGroups: row.max_owned_groups,
    maxMembersPerGroup: row.max_members_per_group,
    maxStorageBytes: Number(row.max_storage_bytes),
    maxUploadBytes: Number(row.max_upload_bytes),
  };
}

/** Archived groups keep their slot; trashed documents keep their bytes until purged. */
export async function readUsage(db: Db, ownerId: string): Promise<OwnerUsage> {
  const [row] = await db.$queryRaw<{ owned: bigint; stored: bigint; reserved: bigint }[]>`
    SELECT (SELECT count(*) FROM study_groups WHERE owner_id = ${ownerId}::uuid) AS owned,
      (SELECT COALESCE(sum(d.size_bytes), 0) FROM group_documents d JOIN study_groups g ON g.id = d.group_id
        WHERE g.owner_id = ${ownerId}::uuid)::bigint AS stored,
      (SELECT COALESCE(sum(bytes), 0) FROM workspace_storage_reservations
        WHERE owner_id = ${ownerId}::uuid AND expires_at > now())::bigint AS reserved`;
  return { ownedGroups: Number(row.owned), storedBytes: Number(row.stored), reservedBytes: Number(row.reserved) };
}

export async function lockOwnerQuota(tx: Db, ownerId: string): Promise<QuotaSnapshot> {
  await lock(tx, `ws-owner:${ownerId}`);
  return { entitlements: await readEntitlements(tx, ownerId), usage: await readUsage(tx, ownerId) };
}

@Injectable()
export class PrismaWorkspaceQuotaRepository implements WorkspaceQuotaRepository {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot(ownerId: string) {
    return { entitlements: await readEntitlements(this.prisma, ownerId), usage: await readUsage(this.prisma, ownerId) };
  }

  async ownedGroups(ownerId: string): Promise<OwnedGroupUsage[]> {
    const rows = await this.prisma.$queryRaw<
      { id: string; slug: string; name: string; status: 'active' | 'archived'; member_count: number; stored: bigint }[]
    >`SELECT g.id, g.slug::text, g.name, g.status::text AS status, g.member_count,
        (SELECT COALESCE(sum(size_bytes), 0) FROM group_documents WHERE group_id = g.id)::bigint AS stored
      FROM study_groups g WHERE g.owner_id = ${ownerId}::uuid ORDER BY g.status, g.created_at`;
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      status: r.status,
      memberCount: r.member_count,
      storedBytes: Number(r.stored),
    }));
  }

  async admitMember(groupId: string, userId: string, guard: SeatGuard) {
    return this.prisma.$transaction(async (tx) => {
      await lock(tx, `ws-group:${groupId}`);
      const group = await tx.study_groups.findUniqueOrThrow({ where: { id: groupId }, select: { owner_id: true } });
      const existing = await tx.group_members.findUnique({ where: { group_id_user_id: { group_id: groupId, user_id: userId } } });
      if (existing?.status === member_status.active) return existing.id;
      const active = await tx.group_members.count({ where: { group_id: groupId, status: member_status.active } });
      guard(await readEntitlements(tx, group.owner_id), active);
      const membership = existing
        ? await tx.group_members.update({
            where: { id: existing.id },
            data: { status: member_status.active, role: group_role.member, joined_at: new Date() },
          })
        : await tx.group_members.create({ data: { group_id: groupId, user_id: userId } });
      await tx.study_groups.update({ where: { id: groupId }, data: { member_count: active + 1, updated_at: new Date() } });
      return membership.id;
    });
  }

  async reserveUpload(input: { ownerId: string; groupId: string; objectKey: string; bytes: number; expiresAt: Date; guard: QuotaGuard }) {
    await this.prisma.$transaction(async (tx) => {
      input.guard(await lockOwnerQuota(tx, input.ownerId));
      await tx.$executeRaw`INSERT INTO workspace_storage_reservations(owner_id, group_id, object_key, bytes, expires_at)
        VALUES (${input.ownerId}::uuid, ${input.groupId}::uuid, ${input.objectKey}, ${BigInt(input.bytes)}, ${input.expiresAt})`;
    });
  }

  async transferOwnership(input: { groupId: string; oldOwnerId: string; newOwnerMembershipId: string; newOwnerId: string; guard: TransferGuard }) {
    await this.prisma.$transaction(async (tx) => {
      // Fixed lock order across both owners prevents deadlocks between opposite transfers.
      for (const id of [input.oldOwnerId, input.newOwnerId].sort()) await lock(tx, `ws-owner:${id}`);
      await lock(tx, `ws-group:${input.groupId}`);
      const group = await tx.study_groups.findUniqueOrThrow({ where: { id: input.groupId }, select: { owner_id: true } });
      if (group.owner_id !== input.oldOwnerId) throw new Error('Ownership changed concurrently');
      const [{ members, stored }] = await tx.$queryRaw<{ members: bigint; stored: bigint }[]>`
        SELECT (SELECT count(*) FROM group_members WHERE group_id = ${input.groupId}::uuid AND status = 'active') AS members,
          (SELECT COALESCE(sum(size_bytes), 0) FROM group_documents WHERE group_id = ${input.groupId}::uuid)::bigint AS stored`;
      input.guard(
        { entitlements: await readEntitlements(tx, input.newOwnerId), usage: await readUsage(tx, input.newOwnerId) },
        { members: Number(members), storedBytes: Number(stored) },
      );
      await tx.group_members.updateMany({
        where: { group_id: input.groupId, user_id: input.oldOwnerId, role: group_role.owner },
        data: { role: group_role.deputy },
      });
      await tx.group_members.update({ where: { id: input.newOwnerMembershipId }, data: { role: group_role.owner } });
      await tx.study_groups.update({ where: { id: input.groupId }, data: { owner_id: input.newOwnerId } });
    });
  }

  async expiredReservations(limit: number) {
    const rows = await this.prisma.$queryRaw<{ id: string; object_key: string }[]>`
      SELECT id, object_key FROM workspace_storage_reservations WHERE expires_at <= now() ORDER BY expires_at LIMIT ${limit}`;
    return rows.map((r) => ({ id: r.id, objectKey: r.object_key }));
  }

  async deleteReservation(id: string) {
    await this.prisma.$executeRaw`DELETE FROM workspace_storage_reservations WHERE id = ${id}::uuid`;
  }

  async isDocumentKeyInUse(objectKey: string) {
    return (await this.prisma.group_documents.count({ where: { storage_key: objectKey } })) > 0;
  }
}

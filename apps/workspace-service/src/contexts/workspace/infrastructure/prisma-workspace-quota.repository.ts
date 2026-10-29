import { Injectable } from '@nestjs/common';
import { group_role, member_status, Prisma } from '@prisma/client';
import { BusinessRuleViolation, QuotaExceeded } from '@codementor/kernel';
import { PrismaService } from '@codementor/platform';
import { QUOTA_CODES, type OwnerEntitlements, type OwnerUsage } from '../domain/model/workspace-quota';
import type {
  OwnedGroupUsage,
  QuotaGuard,
  QuotaSnapshot,
  SeatGuard,
  TransferGuard,
  TransferOffer,
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
      monthly_ai_requests: number;
    }[]
  >`SELECT source, plan_name, max_owned_groups, max_members_per_group, max_storage_bytes, max_upload_bytes, monthly_ai_requests
    FROM workspace_effective_entitlements(${ownerId}::uuid)`;
  // No configured default plan: refuse to consume quota rather than guess a limit.
  if (!row) throw new QuotaExceeded(QUOTA_CODES.unavailable, 'Hệ thống gói Workspace tạm thời chưa sẵn sàng. Vui lòng thử lại sau.');
  return {
    source: row.source,
    planName: row.plan_name,
    maxOwnedGroups: row.max_owned_groups,
    maxMembersPerGroup: row.max_members_per_group,
    maxStorageBytes: Number(row.max_storage_bytes),
    maxUploadBytes: Number(row.max_upload_bytes),
    monthlyAiRequests: row.monthly_ai_requests,
  };
}

/** First day of the current month in Vietnam time — the AI allowance period. */
const AI_MONTH = Prisma.sql`date_trunc('month', now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`;

interface OfferRow {
  id: string;
  group_id: string;
  from_user_id: string;
  to_user_id: string;
  to_membership_id: string;
  status: TransferOffer['status'];
  expires_at: Date;
  created_at: Date;
}

function toOffer(r: OfferRow): TransferOffer {
  return {
    id: r.id,
    groupId: r.group_id,
    fromUserId: r.from_user_id,
    toUserId: r.to_user_id,
    toMembershipId: r.to_membership_id,
    status: r.status,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
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

  async consumeAiRequest(ownerId: string) {
    return this.prisma.$transaction(async (tx) => {
      const { monthlyAiRequests: limit } = await readEntitlements(tx, ownerId);
      // Conditional upsert: the row lock serialises concurrent requests, the WHERE stops at the limit.
      const rows = limit > 0
        ? await tx.$queryRaw<{ requests: number }[]>`
            INSERT INTO workspace_ai_usage(owner_id, month, requests) VALUES (${ownerId}::uuid, ${AI_MONTH}, 1)
            ON CONFLICT (owner_id, month) DO UPDATE SET requests = workspace_ai_usage.requests + 1, updated_at = now()
            WHERE workspace_ai_usage.requests < ${limit}
            RETURNING requests`
        : [];
      if (rows.length) return { used: rows[0].requests };
      return { refused: { limit, used: await this.aiRequestsThisMonth(ownerId, tx) } };
    });
  }

  async aiRequestsThisMonth(ownerId: string, db: Db = this.prisma) {
    const [row] = await db.$queryRaw<{ requests: number }[]>`
      SELECT requests FROM workspace_ai_usage WHERE owner_id = ${ownerId}::uuid AND month = ${AI_MONTH}`;
    return row?.requests ?? 0;
  }

  async offerOwnership(input: { groupId: string; fromUserId: string; toUserId: string; toMembershipId: string }) {
    return this.prisma.$transaction(async (tx) => {
      await lock(tx, `ws-group:${input.groupId}`);
      await tx.$executeRaw`UPDATE workspace_ownership_transfers SET status = 'cancelled', decided_at = now()
        WHERE group_id = ${input.groupId}::uuid AND status = 'pending'`;
      const [row] = await tx.$queryRaw<OfferRow[]>`
        INSERT INTO workspace_ownership_transfers(group_id, from_user_id, to_user_id, to_membership_id)
        VALUES (${input.groupId}::uuid, ${input.fromUserId}::uuid, ${input.toUserId}::uuid, ${input.toMembershipId}::uuid)
        RETURNING *`;
      return toOffer(row);
    });
  }

  async pendingOffer(groupId: string) {
    const [row] = await this.prisma.$queryRaw<OfferRow[]>`
      SELECT * FROM workspace_ownership_transfers WHERE group_id = ${groupId}::uuid AND status = 'pending' AND expires_at > now()`;
    return row ? toOffer(row) : null;
  }

  async offersFor(userId: string) {
    const rows = await this.prisma.$queryRaw<(OfferRow & { slug: string; name: string; from_name: string })[]>`
      SELECT t.*, g.slug::text AS slug, g.name, u.display_name AS from_name
      FROM workspace_ownership_transfers t JOIN study_groups g ON g.id = t.group_id JOIN users u ON u.id = t.from_user_id
      WHERE t.to_user_id = ${userId}::uuid AND t.status = 'pending' AND t.expires_at > now() ORDER BY t.created_at DESC`;
    return rows.map((r) => ({ ...toOffer(r), groupSlug: r.slug, groupName: r.name, fromName: r.from_name }));
  }

  async closeOffer(id: string, status: 'declined' | 'cancelled') {
    const n = await this.prisma.$executeRaw`UPDATE workspace_ownership_transfers SET status = ${status}, decided_at = now()
      WHERE id = ${id}::uuid AND status = 'pending'`;
    return n > 0;
  }

  async acceptOffer(id: string, recipientId: string, guard: TransferGuard) {
    return this.prisma.$transaction(async (tx) => {
      const [offer] = await tx.$queryRaw<OfferRow[]>`SELECT * FROM workspace_ownership_transfers WHERE id = ${id}::uuid FOR UPDATE`;
      if (!offer || offer.to_user_id !== recipientId || offer.status !== 'pending' || offer.expires_at <= new Date())
        throw new BusinessRuleViolation('Lời đề nghị chuyển quyền không còn hiệu lực.');
      // Fixed lock order across both owners prevents deadlocks between opposite transfers.
      for (const userId of [offer.from_user_id, offer.to_user_id].sort()) await lock(tx, `ws-owner:${userId}`);
      await lock(tx, `ws-group:${offer.group_id}`);
      const group = await tx.study_groups.findUnique({ where: { id: offer.group_id }, select: { owner_id: true, status: true } });
      const recipient = await tx.group_members.findUnique({ where: { id: offer.to_membership_id } });
      if (!group || group.owner_id !== offer.from_user_id || recipient?.status !== member_status.active || recipient.user_id !== recipientId)
        throw new BusinessRuleViolation('Nhóm đã thay đổi, lời đề nghị chuyển quyền không còn hiệu lực.');
      const [{ members, stored }] = await tx.$queryRaw<{ members: bigint; stored: bigint }[]>`
        SELECT (SELECT count(*) FROM group_members WHERE group_id = ${offer.group_id}::uuid AND status = 'active') AS members,
          (SELECT COALESCE(sum(size_bytes), 0) FROM group_documents WHERE group_id = ${offer.group_id}::uuid)::bigint AS stored`;
      guard(
        { entitlements: await readEntitlements(tx, recipientId), usage: await readUsage(tx, recipientId) },
        { members: Number(members), storedBytes: Number(stored) },
      );
      await tx.group_members.updateMany({
        where: { group_id: offer.group_id, user_id: offer.from_user_id, role: group_role.owner },
        data: { role: group_role.deputy },
      });
      await tx.group_members.update({ where: { id: offer.to_membership_id }, data: { role: group_role.owner } });
      await tx.study_groups.update({ where: { id: offer.group_id }, data: { owner_id: recipientId } });
      const [accepted] = await tx.$queryRaw<OfferRow[]>`UPDATE workspace_ownership_transfers SET status = 'accepted', decided_at = now()
        WHERE id = ${id}::uuid RETURNING *`;
      return toOffer(accepted);
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

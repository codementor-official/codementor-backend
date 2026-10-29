import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ObjectStorageService, PrismaService } from '@codementor/platform';
import {
  WORKSPACE_QUOTA_REPOSITORY,
  type WorkspaceQuotaRepository,
} from '../domain/port/workspace-quota.repository';
import { overageTimeline, overLimitGroups, usageLevel } from '../domain/model/workspace-quota';

/** Read side of Workspace quotas, plus cleanup of uploads that were never confirmed. */
@Injectable()
export class WorkspaceQuotaService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly logger = new Logger(WorkspaceQuotaService.name);

  constructor(
    @Inject(WORKSPACE_QUOTA_REPOSITORY) private readonly quota: WorkspaceQuotaRepository,
    private readonly storage: ObjectStorageService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    if (process.env.WORKSPACE_UPLOAD_JANITOR_ENABLED === 'false') return;
    this.timer = setInterval(() => void this.releaseAbandonedUploads().then(() => this.sweepOverage()), 10 * 60_000);
    this.timer.unref();
    // Start the over-limit clock soon after a deploy instead of waiting for the first interval.
    setTimeout(() => void this.sweepOverage(), 60_000).unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** The owner's own view: limits, consumption and where each limit stands. */
  async usage(ownerId: string) {
    const [{ entitlements, usage }, groups, aiUsed, overage] = await Promise.all([
      this.quota.snapshot(ownerId),
      this.quota.ownedGroups(ownerId),
      this.quota.aiRequestsThisMonth(ownerId),
      this.quota.overage(ownerId),
    ]);
    const over = overLimitGroups(entitlements, usage, groups);
    const storage = usage.storedBytes + usage.reservedBytes;
    return {
      plan: { name: entitlements.planName, source: entitlements.source },
      entitlements,
      usage: { ...usage, totalBytes: storage, aiRequestsThisMonth: aiUsed },
      levels: {
        groups: usageLevel(usage.ownedGroups, entitlements.maxOwnedGroups),
        storage: usageLevel(storage, entitlements.maxStorageBytes),
        ai: usageLevel(aiUsed, entitlements.monthlyAiRequests),
      },
      overLimit: {
        groups: usage.ownedGroups > entitlements.maxOwnedGroups,
        storage: storage > entitlements.maxStorageBytes,
        memberGroupIds: groups
          .filter((g) => entitlements.maxMembersPerGroup !== null && g.memberCount > entitlements.maxMembersPerGroup)
          .map((g) => g.id),
      },
      groups: groups.map((g) => ({
        ...g,
        memberLevel: usageLevel(g.memberCount, entitlements.maxMembersPerGroup),
        overLimitReasons: over.get(g.id) ?? [],
      })),
      // The clock starts at the next sweep; until then an over-limit owner sees no dates yet.
      overage: overage && over.size ? overageTimeline(overage.overSince, overage.policy) : null,
    };
  }

  /** Platform-wide storage picture for administrators. */
  async adminOverview() {
    const [[totals], distribution, nearLimit] = await Promise.all([
      this.prisma.$queryRaw<{ stored: bigint; groups: bigint; owners: bigint; reserved: bigint }[]>`
        SELECT (SELECT COALESCE(sum(size_bytes), 0) FROM group_documents)::bigint AS stored,
          (SELECT count(*) FROM study_groups) AS groups,
          (SELECT count(DISTINCT owner_id) FROM study_groups) AS owners,
          (SELECT COALESCE(sum(bytes), 0) FROM workspace_storage_reservations WHERE expires_at > now())::bigint AS reserved`,
      this.prisma.$queryRaw<{ bucket: string; owners: bigint }[]>`
        WITH per_owner AS (
          SELECT g.owner_id, COALESCE(sum(d.size_bytes), 0) AS bytes FROM study_groups g
          LEFT JOIN group_documents d ON d.group_id = g.id GROUP BY g.owner_id)
        SELECT CASE WHEN bytes < 10485760 THEN '< 10 MB' WHEN bytes < 104857600 THEN '10–100 MB'
          WHEN bytes < 1073741824 THEN '100 MB–1 GB' WHEN bytes < 10737418240 THEN '1–10 GB' ELSE '≥ 10 GB' END AS bucket,
          count(*) AS owners
        FROM per_owner GROUP BY 1 ORDER BY min(bytes)`,
      this.prisma.$queryRaw<{ owner_id: string; name: string; email: string; plan: string; used: bigint; max: bigint; groups: bigint; max_groups: number }[]>`
        WITH per_owner AS (
          SELECT g.owner_id, count(DISTINCT g.id) AS groups, COALESCE(sum(d.size_bytes), 0)::bigint AS used
          FROM study_groups g LEFT JOIN group_documents d ON d.group_id = g.id GROUP BY g.owner_id)
        SELECT p.owner_id, u.display_name AS name, u.email::text AS email, e.plan_name AS plan, p.used,
          e.max_storage_bytes AS max, p.groups, e.max_owned_groups AS max_groups
        FROM per_owner p JOIN users u ON u.id = p.owner_id
        CROSS JOIN LATERAL workspace_effective_entitlements(p.owner_id) e
        WHERE p.used >= e.max_storage_bytes * 0.85 OR p.groups >= e.max_owned_groups
        ORDER BY p.used::numeric / GREATEST(e.max_storage_bytes, 1) DESC LIMIT 20`,
    ]);
    return {
      storedBytes: Number(totals.stored),
      reservedBytes: Number(totals.reserved),
      groups: Number(totals.groups),
      owners: Number(totals.owners),
      distribution: distribution.map((d) => ({ bucket: d.bucket, owners: Number(d.owners) })),
      nearLimit: nearLimit.map((o) => ({
        ownerId: o.owner_id,
        name: o.name,
        email: o.email,
        plan: o.plan,
        usedBytes: Number(o.used),
        maxStorageBytes: Number(o.max),
        ownedGroups: Number(o.groups),
        maxOwnedGroups: o.max_groups,
      })),
    };
  }

  /**
   * Starts or clears each owner's over-limit clock. Runs every 10 minutes; restrictions are
   * recomputed on every request, so renewing or cleaning up lifts them at once.
   */
  async sweepOverage() {
    let marked = 0;
    try {
      for (const ownerId of await this.quota.groupOwners()) {
        const [{ entitlements, usage }, groups] = await Promise.all([this.quota.snapshot(ownerId), this.quota.ownedGroups(ownerId)]);
        const over = overLimitGroups(entitlements, usage, groups).size > 0;
        await this.quota.markOverage(ownerId, over);
        if (over) marked++;
      }
    } catch (error) {
      this.logger.warn(`Could not sweep Workspace overage: ${(error as Error).message}`);
    }
    return { marked };
  }

  /**
   * Expired reservations are uploads nobody confirmed. Delete the object unless a document took
   * it, then drop the reservation; the bytes stopped counting when the reservation expired.
   */
  async releaseAbandonedUploads() {
    try {
      for (const r of await this.quota.expiredReservations(100)) {
        if (!(await this.quota.isDocumentKeyInUse(r.objectKey))) await this.storage.deleteObject(r.objectKey);
        await this.quota.deleteReservation(r.id);
      }
    } catch (error) {
      this.logger.warn(`Could not release abandoned uploads: ${(error as Error).message}`);
    }
  }
}

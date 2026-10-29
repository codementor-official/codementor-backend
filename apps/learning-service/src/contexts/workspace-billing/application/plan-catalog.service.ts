import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AlreadyExists, BusinessRuleViolation, NotFound } from '@codementor/kernel';
import { CommerceStore, audit, lock, type Tx } from '../../commerce/infrastructure/commerce.store';
import { FEATURES, FEATURE_KEYS, versionProblems } from '../domain/billing';
import {
  entitlementsOf,
  planView,
  pricesOf,
  versionView,
  type PlanRow,
  type VersionRow,
} from '../infrastructure/billing.rows';
import type { CreatePlanDto, DraftVersionDto, PublishVersionDto, UpdatePlanDto } from '../presentation/workspace-billing.dto';

/** The version on sale: highest published version whose `available_from` has passed. */
export const ON_SALE_VERSION = Prisma.raw(`SELECT v.* FROM workspace_plan_versions v WHERE v.plan_id = p.id
  AND v.status = 'published' AND v.available_from <= now() ORDER BY v.version DESC LIMIT 1`);

@Injectable()
export class PlanCatalogService {
  constructor(private readonly store: CommerceStore) {}

  /** Public catalog: every visible plan with the version a buyer would get right now. */
  async onSale() {
    const rows = await this.store.db.$queryRaw<(PlanRow & { v: VersionRow })[]>(
      Prisma.sql`SELECT p.*, to_jsonb(v) AS v FROM workspace_plans p
        JOIN LATERAL (${ON_SALE_VERSION}) v ON true
        WHERE p.status = 'active' ORDER BY p.sort_order, p.code`,
    );
    return {
      plans: rows.map((row) => ({ ...planView(row), version: versionView(fromJson(row.v)) })),
      features: FEATURE_KEYS.map((key) => ({ key, ...FEATURES[key] })),
    };
  }

  async adminList() {
    const plans = await this.store.db.$queryRaw<(PlanRow & { subscribers: bigint })[]>`
      SELECT p.*, (SELECT count(*) FROM workspace_subscriptions s WHERE s.plan_id = p.id AND s.ended_at IS NULL) AS subscribers
      FROM workspace_plans p ORDER BY p.sort_order, p.code`;
    const versions = await this.store.db.$queryRaw<VersionRow[]>`
      SELECT * FROM workspace_plan_versions ORDER BY plan_id, version DESC`;
    const now = Date.now();
    return plans.map((p) => {
      const own = versions.filter((v) => v.plan_id === p.id);
      const onSale = own.find((v) => v.status === 'published' && v.available_from && v.available_from.getTime() <= now);
      const scheduled = own.find((v) => v.status === 'published' && v.available_from && v.available_from.getTime() > now);
      const draft = own.find((v) => v.status === 'draft');
      return {
        ...planView(p),
        openSubscriptions: Number(p.subscribers),
        onSale: onSale ? versionView(onSale) : null,
        scheduled: scheduled ? versionView(scheduled) : null,
        draft: draft ? versionView(draft) : null,
      };
    });
  }

  async versions(planId: string) {
    await this.requirePlan(this.store.db, planId);
    const rows = await this.store.db.$queryRaw<(VersionRow & { subscribers: bigint })[]>`
      SELECT v.*, (SELECT count(*) FROM workspace_subscriptions s WHERE s.plan_version_id = v.id) AS subscribers
      FROM workspace_plan_versions v WHERE v.plan_id = ${planId}::uuid ORDER BY v.version DESC`;
    return rows.map((v) => ({ ...versionView(v), subscriptions: Number(v.subscribers) }));
  }

  async createPlan(actorId: string, dto: CreatePlanDto) {
    return this.store.transaction(async (tx) => {
      const [exists] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM workspace_plans WHERE code = ${dto.code}`;
      if (exists) throw new AlreadyExists('Mã gói', { code: dto.code });
      const [{ next }] = await tx.$queryRaw<{ next: number }[]>`SELECT COALESCE(max(sort_order), 0) + 1 AS next FROM workspace_plans`;
      const [plan] = await tx.$queryRaw<PlanRow[]>`
        INSERT INTO workspace_plans(code, sort_order, is_purchasable, status)
        VALUES (${dto.code}, ${next}, false, 'hidden') RETURNING *`;
      await this.writeDraft(tx, plan, actorId, dto.draft);
      await audit(tx, 'workspace_plan.created', plan.id, actorId, { code: dto.code });
      return planView(plan);
    });
  }

  /** Presentation only. Prices and limits change through versions, never here. */
  async updatePlan(actorId: string, planId: string, dto: UpdatePlanDto) {
    return this.store.transaction(async (tx) => {
      await lock(tx, `ws-plan:${planId}`);
      const plan = await this.requirePlan(tx, planId);
      if (plan.is_default && (dto.isPurchasable || (dto.status && dto.status !== 'active')))
        throw new BusinessRuleViolation('Gói mặc định luôn hiển thị và không bán.');
      if (dto.isPurchasable && dto.status !== undefined && dto.status !== 'active')
        throw new BusinessRuleViolation('Chỉ gói đang hoạt động mới được mở bán.');
      const [updated] = await tx.$queryRaw<PlanRow[]>`
        UPDATE workspace_plans SET
          sort_order = COALESCE(${dto.sortOrder ?? null}::integer, sort_order),
          is_recommended = COALESCE(${dto.isRecommended ?? null}::boolean, is_recommended),
          is_purchasable = COALESCE(${dto.isPurchasable ?? null}::boolean, is_purchasable),
          status = COALESCE(${dto.status ?? null}, status),
          updated_at = now()
        WHERE id = ${planId}::uuid RETURNING *`;
      if (updated.is_purchasable && updated.status !== 'active')
        throw new BusinessRuleViolation('Chỉ gói đang hoạt động mới được mở bán.');
      if (updated.is_recommended)
        await tx.$executeRaw`UPDATE workspace_plans SET is_recommended = false, updated_at = now()
          WHERE id <> ${planId}::uuid AND is_recommended`;
      await audit(tx, 'workspace_plan.updated', planId, actorId, { before: planView(plan), after: planView(updated) });
      return planView(updated);
    });
  }

  async saveDraft(actorId: string, planId: string, dto: DraftVersionDto) {
    return this.store.transaction(async (tx) => {
      await lock(tx, `ws-plan:${planId}`);
      const plan = await this.requirePlan(tx, planId);
      const draft = await this.writeDraft(tx, plan, actorId, dto);
      await audit(tx, 'workspace_plan.draft_saved', planId, actorId, { versionId: draft.id, version: draft.version });
      return versionView(draft);
    });
  }

  async discardDraft(actorId: string, planId: string) {
    return this.store.transaction(async (tx) => {
      await lock(tx, `ws-plan:${planId}`);
      const [removed] = await tx.$queryRaw<{ id: string; version: number }[]>`
        DELETE FROM workspace_plan_versions WHERE plan_id = ${planId}::uuid AND status = 'draft' RETURNING id, version`;
      if (!removed) throw new NotFound('Bản nháp');
      await audit(tx, 'workspace_plan.draft_discarded', planId, actorId, removed);
      return { discarded: true };
    });
  }

  /**
   * Publishing only affects new purchases. `expectedUpdatedAt` makes a concurrent edit by
   * another administrator fail instead of publishing text nobody reviewed.
   */
  async publish(actorId: string, planId: string, dto: PublishVersionDto) {
    return this.store.transaction(async (tx) => {
      await lock(tx, `ws-plan:${planId}`);
      const plan = await this.requirePlan(tx, planId);
      const [draft] = await tx.$queryRaw<VersionRow[]>`
        SELECT * FROM workspace_plan_versions WHERE plan_id = ${planId}::uuid AND status = 'draft' FOR UPDATE`;
      if (!draft) throw new NotFound('Bản nháp');
      if (draft.updated_at.toISOString() !== new Date(dto.expectedUpdatedAt).toISOString())
        throw new BusinessRuleViolation('Bản nháp đã thay đổi sau khi bạn mở. Tải lại và kiểm tra trước khi xuất bản.', {
          code: 'WORKSPACE_PLAN_DRAFT_CHANGED',
        });
      const problems = versionProblems({ ...pricesOf(draft), ...entitlementsOf(draft), isDefault: plan.is_default });
      if (problems.length) throw new BusinessRuleViolation(problems.join(' '), { problems });
      const availableFrom = dto.availableFrom ? new Date(dto.availableFrom) : new Date();
      if (availableFrom.getTime() < Date.now() - 60_000)
        throw new BusinessRuleViolation('Thời điểm áp dụng không được ở quá khứ.');
      const [previous] = await tx.$queryRaw<VersionRow[]>`
        SELECT * FROM workspace_plan_versions WHERE plan_id = ${planId}::uuid AND status = 'published'
        ORDER BY version DESC LIMIT 1`;
      const [published] = await tx.$queryRaw<VersionRow[]>`
        UPDATE workspace_plan_versions SET status = 'published', published_at = now(), published_by = ${actorId}::uuid,
          available_from = ${availableFrom}, updated_at = now()
        WHERE id = ${draft.id}::uuid RETURNING *`;
      await audit(tx, 'workspace_plan.published', planId, actorId, {
        versionId: published.id,
        version: published.version,
        availableFrom,
        before: previous ? versionView(previous) : null,
        after: versionView(published),
        impact: 'new purchases only; existing subscriptions keep their snapshot',
      });
      return versionView(published);
    });
  }

  private async writeDraft(tx: Tx, plan: PlanRow, actorId: string, dto: DraftVersionDto) {
    const problems = versionProblems({ ...dto, isDefault: plan.is_default });
    if (problems.length) throw new BusinessRuleViolation(problems.join(' '), { problems });
    const highlights = dto.highlights.map((h) => h.trim()).filter(Boolean);
    const [draft] = await tx.$queryRaw<VersionRow[]>`
      INSERT INTO workspace_plan_versions(plan_id, version, name, tagline, description, highlights,
        monthly_price_vnd, annual_price_vnd, max_owned_groups, max_members_per_group, max_storage_bytes,
        max_upload_bytes, monthly_ai_requests, features, created_by)
      VALUES (${plan.id}::uuid,
        (SELECT COALESCE(max(version), 0) + 1 FROM workspace_plan_versions WHERE plan_id = ${plan.id}::uuid),
        ${dto.name.trim()}, ${dto.tagline.trim()}, ${dto.description.trim()}, ${highlights}::text[],
        ${dto.monthlyPriceVnd}, ${dto.annualPriceVnd}::integer, ${dto.maxOwnedGroups}, ${dto.maxMembersPerGroup}::integer,
        ${BigInt(dto.maxStorageBytes)}, ${BigInt(dto.maxUploadBytes)}, ${dto.monthlyAiRequests}, ${dto.features}::text[],
        ${actorId}::uuid)
      ON CONFLICT (plan_id) WHERE status = 'draft' DO UPDATE SET
        name = EXCLUDED.name, tagline = EXCLUDED.tagline, description = EXCLUDED.description,
        highlights = EXCLUDED.highlights, monthly_price_vnd = EXCLUDED.monthly_price_vnd,
        annual_price_vnd = EXCLUDED.annual_price_vnd, max_owned_groups = EXCLUDED.max_owned_groups,
        max_members_per_group = EXCLUDED.max_members_per_group, max_storage_bytes = EXCLUDED.max_storage_bytes,
        max_upload_bytes = EXCLUDED.max_upload_bytes, monthly_ai_requests = EXCLUDED.monthly_ai_requests,
        features = EXCLUDED.features, updated_at = now()
      RETURNING *`;
    return draft;
  }

  private async requirePlan(tx: Tx, planId: string) {
    const [plan] = await tx.$queryRaw<PlanRow[]>`SELECT * FROM workspace_plans WHERE id = ${planId}::uuid`;
    if (!plan) throw new NotFound('Gói Workspace', planId);
    return plan;
  }
}

/** `to_jsonb(row)` turns timestamps into strings and bigints into numbers. */
function fromJson(v: VersionRow): VersionRow {
  return {
    ...v,
    available_from: v.available_from ? new Date(v.available_from) : null,
    published_at: v.published_at ? new Date(v.published_at) : null,
    created_at: new Date(v.created_at),
    updated_at: new Date(v.updated_at),
  };
}

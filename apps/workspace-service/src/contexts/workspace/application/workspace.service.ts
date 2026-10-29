import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { AlreadyExists, BusinessRuleViolation, NotAuthorized, NotFound, QuotaExceeded } from '@codementor/kernel';
import { TOPICS } from '@codementor/contracts';
import { EVENT_BUS, type EventBus } from '@codementor/messaging';
import {
  assertCanManageWorkspace,
  assertConfigurableRole,
  normalisePermissionPatch,
  ADMIN_VIEW_PERMISSIONS,
  resolveWorkspacePermissions,
  rolePermissionsFor,
  WORKSPACE_PERMISSIONS,
  type WorkspaceRole,
} from '../domain/model/workspace-policy';
import {
  WORKSPACE_REPOSITORY,
  type WorkspaceRepository,
} from '../domain/port/workspace.repository';
import {
  WORKSPACE_QUOTA_REPOSITORY,
  type WorkspaceQuotaRepository,
} from '../domain/port/workspace-quota.repository';
import {
  assertTransferable,
  assertWithinQuota,
  groupSlotProblem,
  memberSeatProblem,
  overageTimeline,
  overLimitGroups,
  QUOTA_CODES,
  restrictionMessage,
  transferProblems,
  type GroupRestriction,
} from '../domain/model/workspace-quota';
import type {
  CreateWorkspaceDto,
  JoinWorkspaceDto,
  ListMembersQueryDto,
  ListWorkspacesQueryDto,
  RequestWorkspaceJoinDto,
  TransferOwnershipDto,
  UpdateMemberPermissionsDto,
  UpdateMemberRoleDto,
  UpdateRolePermissionsDto,
  UpdateWorkspaceDto,
} from '../presentation/dto/workspace.dto';

const DEFAULT_LIMIT = 8;

/** Application layer: điều phối use case; policy nằm ở domain, I/O nằm ở repository port. */
@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    @Inject(WORKSPACE_REPOSITORY) private readonly workspaces: WorkspaceRepository,
    @Inject(WORKSPACE_QUOTA_REPOSITORY) private readonly quota: WorkspaceQuotaRepository,
    @Inject(EVENT_BUS) private readonly events: EventBus,
  ) {}

  async list(userId: string, query: ListWorkspacesQueryDto) {
    const limit = clamp(query.limit, DEFAULT_LIMIT, 50);
    const page = Math.max(query.page ?? 1, 1);
    const result = await this.workspaces.listForUser(userId, {
      ids: query.ids,
      scope: query.scope,
      q: query.q?.trim() || undefined,
      topic: query.topic?.trim() || undefined,
      page,
      limit,
    });
    return {
      items: result.items.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        topic: row.topic,
        memberCount: row.memberCount,
        avatarUrl: row.avatarUrl,
        coverUrl: row.coverUrl,
        coverPosition: row.coverPosition,
        coverFit: row.coverFit,
        coverHeight: row.coverHeight,
        privacy: row.privacy,
        joinPolicy: row.joinPolicy,
        lastActivityAt: row.lastActivityAt ?? row.updatedAt,
        owner: row.owner,
        memberPreview: row.memberPreview,
        role: row.role,
        openTaskCount: row.openTaskCount,
        progressPercent: row.progressPercent,
        unreadCount: row.unreadCount,
      })),
      page,
      limit,
      total: result.total,
      totalPages: Math.ceil(result.total / limit),
    };
  }

  summary(userId: string) {
    return this.workspaces.summaryForUser(userId);
  }

  async detail(userId: string, slug: string) {
    const data = await this.workspaces.findDetail(slug, userId);
    // Admin mở nhóm từ báo cáo vi phạm: vào thẳng để xem, không phải xin tham gia. Không tạo
    // thành viên thật — `adminView` chỉ có quyền xem (ADMIN_VIEW_PERMISSIONS).
    const adminView = !!data && !data.membership && (await this.workspaces.isPlatformAdmin(userId));
    if (!data || (!data.membership && !adminView))
      throw new NotFound('Không tìm thấy nhóm học tập');
    const membership = data.membership ?? { id: '', role: 'member' as const, joinedAt: null };
    const permissions = adminView
      ? ADMIN_VIEW_PERMISSIONS
      : resolveWorkspacePermissions(membership.role, data.rolePermissions, data.memberOverrides);
    const plan = await this.groupPlan(data.owner.id, data.id);
    // Hidden groups stay reachable for their owner (to clean up) and for moderators.
    if (plan.restriction?.stage === 'hidden' && membership.role !== 'owner' && !adminView)
      throw new QuotaExceeded(QUOTA_CODES.hidden, restrictionMessage(plan.restriction), { stage: 'hidden' });
    return {
      id: data.id,
      slug: data.slug,
      name: data.name,
      description: data.description,
      topic: data.topic,
      status: data.status,
      memberCount: data.memberCount,
      avatarUrl: data.avatarUrl,
      coverUrl: data.coverUrl,
      coverKey: data.coverKey,
      coverPosition: data.coverPosition,
      coverFit: data.coverFit,
      coverHeight: data.coverHeight,
      privacy: data.privacy,
      joinPolicy: data.joinPolicy,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      lastActivityAt: data.lastActivityAt,
      owner: data.owner,
      currentMembership: {
        id: membership.id,
        role: membership.role,
        joinedAt: membership.joinedAt,
        permissions,
        adminView,
      },
      plan,
      inviteCode: membership.role === 'owner' ? data.inviteCode : null,
      rolePermissions:
        membership.role === 'owner'
          ? {
              deputy: rolePermissionsFor('deputy', data.rolePermissions),
              member: rolePermissionsFor('member', data.rolePermissions),
            }
          : null,
    };
  }

  async publicDetail(userId: string, slug: string) {
    const data = await this.workspaces.findDetail(slug, userId);
    if (!data || data.privacy !== 'public') throw new NotFound('Không tìm thấy nhóm học tập');
    const request = data.membership
      ? null
      : await this.workspaces.findJoinRequestForUser(data.id, userId);

    return {
      id: data.id,
      slug: data.slug,
      name: data.name,
      description: data.description,
      topic: data.topic,
      memberCount: data.memberCount,
      coverUrl: data.coverUrl,
      coverPosition: data.coverPosition,
      coverFit: data.coverFit,
      coverHeight: data.coverHeight,
      joinPolicy: data.joinPolicy,
      createdAt: data.createdAt,
      lastActivityAt: data.lastActivityAt ?? data.updatedAt,
      owner: {
        id: data.owner.id,
        displayName: data.owner.displayName,
        avatarUrl: data.owner.avatarUrl,
        handle: data.owner.handle,
      },
      membership: data.membership ? { role: data.membership.role } : null,
      joinRequestStatus: request?.status ?? null,
    };
  }

  /** Internal helper for signing a public cover without exposing its S3 key in the DTO. */
  async publicCoverSource(userId: string, slug: string) {
    const data = await this.workspaces.findDetail(slug, userId);
    if (!data || data.privacy !== 'public') throw new NotFound('Không tìm thấy nhóm học tập');
    return { coverKey: data.coverKey, coverUrl: data.coverUrl };
  }

  async create(userId: string, dto: CreateWorkspaceDto) {
    const name = dto.name.trim();
    if (!name) throw new BusinessRuleViolation('Tên nhóm không được để trống');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const created = await this.workspaces.create({
          slug: `${slugify(name)}-${randomSuffix(5)}`,
          inviteCode: randomInviteCode(),
          name,
          description: trimOptional(dto.description),
          topic: trimOptional(dto.topic),
          ownerId: userId,
        }, (snapshot) => assertWithinQuota(groupSlotProblem(snapshot.entitlements, snapshot.usage)));
        return this.detail(userId, created.slug);
      } catch (error) {
        if (attempt === 4 || !isUniqueViolation(error)) throw error;
      }
    }
    throw new AlreadyExists('Nhóm học tập');
  }

  async update(userId: string, slug: string, dto: UpdateWorkspaceDto) {
    const workspace = await this.requireOwner(userId, slug);
    const name = dto.name === undefined ? undefined : dto.name.trim();
    if (name === '') throw new BusinessRuleViolation('Tên nhóm không được để trống');
    const nextPrivacy = dto.privacy ?? workspace.privacy;
    const nextJoinPolicy = dto.joinPolicy ?? workspace.joinPolicy;
    if (nextPrivacy === 'public' && nextJoinPolicy === 'invite_only')
      throw new BusinessRuleViolation(
        'Nhóm công khai phải cho phép tham gia ngay hoặc gửi yêu cầu xét duyệt',
      );
    await this.workspaces.update(workspace.id, {
      name,
      description: dto.description === undefined ? undefined : trimOptional(dto.description),
      topic: dto.topic === undefined ? undefined : trimOptional(dto.topic),
      privacy: dto.privacy,
      joinPolicy: dto.joinPolicy,
      avatarUrl: dto.avatarUrl,
      avatarKey: dto.avatarKey,
      coverUrl: dto.coverUrl,
      coverKey: dto.coverKey,
      coverPosition: dto.coverPosition,
      coverFit: dto.coverFit,
      coverHeight: dto.coverHeight,
    });
    return this.detail(userId, slug);
  }
  async archive(userId: string, slug: string) {
    const workspace = await this.requireOwner(userId, slug);
    await this.workspaces.update(workspace.id, { status: 'archived' });
    return { archived: true };
  }
  async rotateInviteCode(userId: string, slug: string) {
    const workspace = await this.requireOwner(userId, slug);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const inviteCode = randomInviteCode();
        await this.workspaces.update(workspace.id, { inviteCode });
        return { inviteCode };
      } catch (error) {
        if (attempt === 4 || !isUniqueViolation(error)) throw error;
      }
    }
    throw new AlreadyExists('Mã mời');
  }

  async join(userId: string, dto: JoinWorkspaceDto) {
    const workspace = await this.workspaces.findActiveByInviteCode(dto.inviteCode.trim());
    if (!workspace) throw new NotFound('Không tìm thấy nhóm học tập bằng mã mời này');
    const existing = await this.workspaces.findMembershipAny(workspace.id, userId);
    if (existing?.status === 'active')
      return { status: 'joined' as const, workspaceSlug: workspace.slug };

    // A valid invite code identifies the workspace, but it must not bypass an
    // approval policy. Only invite-only and open workspaces activate the member
    // immediately; approval workspaces always create a reviewable request.
    if (workspace.joinPolicy === 'approval') {
      const request = await this.workspaces.upsertJoinRequest(workspace.id, userId);
      return {
        status: 'pending' as const,
        requestId: request.id,
        workspaceSlug: workspace.slug,
      };
    }
    await this.admit(workspace.id, userId);
    return { status: 'joined' as const, workspaceSlug: workspace.slug };
  }
  async leave(userId: string, slug: string) {
    const workspace = await this.requireActive(slug);
    const member = await this.workspaces.findMembership(workspace.id, userId);
    if (!member) throw new NotFound('Bạn không còn là thành viên của nhóm này');
    if (member.role === 'owner')
      throw new BusinessRuleViolation('Chủ nhóm cần chuyển quyền sở hữu trước khi rời nhóm');
    await this.workspaces.updateMember(member.id, { status: 'removed' });
    await this.workspaces.refreshMemberCount(workspace.id);
    await this.workspaces.recordActivity(
      workspace.id,
      userId,
      'đã rời nhóm học tập',
      'membership',
      member.id,
    );
    return { left: true };
  }

  async members(userId: string, slug: string, query: ListMembersQueryDto) {
    const workspace = await this.requireActive(slug);
    const requester = await this.viewer(workspace.id, userId);
    const page = Math.max(query.page ?? 1, 1);
    const limit = clamp(query.limit, 10, 100);
    const result = await this.workspaces.listMembers(workspace.id, {
      q: (query.search ?? query.q)?.trim() || undefined,
      role: query.role,
      page,
      limit,
      progress: query.progress,
      activityLevel: query.activityLevel,
      submissionStatus: query.submissionStatus,
      joinedFrom: query.joinedFrom ? new Date(query.joinedFrom) : undefined,
      joinedTo: query.joinedTo ? endOfDay(new Date(query.joinedTo)) : undefined,
    });
    const canViewPrivate = requester.role === 'owner' || requester.role === 'deputy';
    return {
      items: result.items.map((member) => ({
        id: member.id,
        user: canViewPrivate ? member.user : publicUser(member.user),
        role: member.role,
        joinedAt: member.joinedAt,
      })),
      page,
      limit,
      total: result.total,
      totalPages: Math.ceil(result.total / limit),
      canManage: requester.role === 'owner',
      canViewPrivate,
    };
  }
  async memberDetail(userId: string, slug: string, memberId: string) {
    const workspace = await this.requireActive(slug);
    const requester = await this.viewer(workspace.id, userId);
    const member = await this.workspaces.memberDashboard(workspace.id, memberId);
    if (!member) throw new NotFound('Không tìm thấy thành viên');
    const base = {
      id: member.id,
      user: requester.role === 'member' ? publicUser(member.user) : member.user,
      role: member.role,
      joinedAt: member.joinedAt,
      xp: member.xp,
      solvedCount: member.solvedCount,
      currentStreakDays: member.currentStreakDays,
      longestStreakDays: member.longestStreakDays,
      activeDays: member.activeDays,
      lastActiveAt: member.lastActiveAt,
      activityHeatmap: member.activityHeatmap,
      assignmentStats: member.assignmentStats,
      submissionStats: member.submissionStats,
    };
    if (requester.role === 'member')
      return { ...base, access: 'public' as const, canManagePermissions: false };
    const permissions = resolveWorkspacePermissions(
      member.role,
      member.rolePermissions,
      member.memberOverrides,
    );
    const roleDefaults =
      member.role === 'owner'
        ? permissions
        : rolePermissionsFor(member.role, member.rolePermissions);
    return {
      ...base,
      access: 'manager' as const,
      recentActivities: member.recentActivities,
      permissions,
      roleDefaults,
      overrides: Object.fromEntries(
        member.memberOverrides.map((item) => [item.permission, item.allowed]),
      ),
      canManagePermissions: requester.role === 'owner' && member.role !== 'owner',
    };
  }
  async updateMemberRole(userId: string, slug: string, memberId: string, dto: UpdateMemberRoleDto) {
    const workspace = await this.requireOwner(userId, slug);
    const member = await this.workspaces.findMember(workspace.id, memberId);
    if (!member) throw new NotFound('Không tìm thấy thành viên');
    if (member.role === 'owner') throw new BusinessRuleViolation('Không thể đổi role của Chủ nhóm');
    await this.workspaces.updateMember(member.id, { role: dto.role });
    return { updated: true };
  }
  async removeMember(userId: string, slug: string, memberId: string, rawReason?: string) {
    const workspace = await this.requireActive(slug);
    const requester = await this.workspaces.findMembershipWithPermissions(workspace.id, userId);
    const target = await this.workspaces.findMember(workspace.id, memberId);
    if (!requester || !target) throw new NotFound('Không tìm thấy thành viên');
    if (target.role === 'owner') throw new BusinessRuleViolation('Không thể xoá Chủ nhóm');
    const permissions = resolveWorkspacePermissions(
      requester.role,
      requester.rolePermissions,
      requester.memberOverrides,
    );
    if (requester.role !== 'owner' && !permissions.remove_member)
      throw new NotAuthorized('Bạn không có quyền xoá thành viên');
    if (requester.role !== 'owner' && target.role !== 'member')
      throw new NotAuthorized('Chỉ Chủ nhóm mới có thể xoá Phó nhóm');
    const reason = rawReason?.trim();
    if (!reason) throw new BusinessRuleViolation('Vui lòng nhập lý do xóa thành viên khỏi nhóm');
    await this.workspaces.updateMember(target.id, { status: 'removed' });
    await this.workspaces.refreshMemberCount(workspace.id);
    await this.workspaces.recordActivity(workspace.id, userId, `đã xóa thành viên khỏi nhóm · ${reason}`, 'membership', target.id);
    try {
      await this.events.publish(TOPICS.WORKSPACE_ACTIVITY, {
        groupId: workspace.id,
        entityId: target.id,
        action: 'member_removed',
        actorUserId: userId,
        memberUserId: target.userId,
        reason,
      });
    } catch (error) {
      this.logger.error('Không phát được thông báo xóa thành viên', error as Error);
    }
    return { removed: true };
  }
  /**
   * Offers the group to a member. Nothing changes hands until they accept; the recipient's
   * quotas are checked now for early feedback and again, atomically, on acceptance.
   */
  async transferOwnership(userId: string, slug: string, dto: TransferOwnershipDto) {
    const workspace = await this.requireOwner(userId, slug);
    const target = await this.workspaces.findMember(workspace.id, dto.memberId);
    if (!target) throw new NotFound('Người nhận quyền phải là thành viên đang hoạt động');
    if (target.userId === userId) throw new BusinessRuleViolation('Bạn đang là Chủ nhóm');
    const [recipient, groups] = await Promise.all([this.quota.snapshot(target.userId), this.quota.ownedGroups(userId)]);
    const group = groups.find((g) => g.id === workspace.id);
    assertTransferable(
      transferProblems(recipient.entitlements, recipient.usage, { members: group?.memberCount ?? workspace.memberCount, storedBytes: group?.storedBytes ?? 0 }),
    );
    const offer = await this.quota.offerOwnership({
      groupId: workspace.id,
      fromUserId: userId,
      toUserId: target.userId,
      toMembershipId: target.id,
    });
    await this.workspaces.recordActivity(workspace.id, userId, 'đã đề nghị chuyển quyền Chủ nhóm', 'membership', target.id);
    try {
      await this.events.publish(TOPICS.WORKSPACE_ACTIVITY, {
        groupId: workspace.id,
        entityId: offer.id,
        action: 'ownership_offered',
        actorUserId: userId,
        memberUserId: target.userId,
      });
    } catch (error) {
      this.logger.error('Không phát được thông báo đề nghị chuyển quyền', error as Error);
    }
    return { status: 'pending' as const, offer };
  }

  /** The pending offer of a group, visible to its owner and to the recipient. */
  async pendingTransfer(userId: string, slug: string) {
    const workspace = await this.requireActive(slug);
    const offer = await this.quota.pendingOffer(workspace.id);
    if (!offer || (offer.fromUserId !== userId && offer.toUserId !== userId)) return null;
    return { ...offer, forMe: offer.toUserId === userId };
  }

  myTransferOffers(userId: string) {
    return this.quota.offersFor(userId);
  }

  async acceptTransfer(userId: string, slug: string, offerId: string) {
    const workspace = await this.requireActive(slug);
    const offer = await this.quota.acceptOffer(offerId, userId, (snapshot, group) =>
      assertTransferable(transferProblems(snapshot.entitlements, snapshot.usage, group)),
    );
    if (offer.groupId !== workspace.id) throw new NotFound('Không tìm thấy lời đề nghị');
    await this.workspaces.recordActivity(workspace.id, userId, 'đã nhận quyền Chủ nhóm', 'membership', offer.toMembershipId);
    return { transferred: true };
  }

  async declineTransfer(userId: string, slug: string, offerId: string) {
    const offer = await this.pendingTransfer(userId, slug);
    if (!offer || offer.id !== offerId || offer.toUserId !== userId) throw new NotFound('Không tìm thấy lời đề nghị');
    await this.quota.closeOffer(offerId, 'declined');
    return { declined: true };
  }

  async cancelTransfer(userId: string, slug: string, offerId: string) {
    await this.requireOwner(userId, slug);
    const offer = await this.pendingTransfer(userId, slug);
    if (!offer || offer.id !== offerId) throw new NotFound('Không tìm thấy lời đề nghị');
    await this.quota.closeOffer(offerId, 'cancelled');
    return { cancelled: true };
  }
  async updateRolePermissions(
    userId: string,
    slug: string,
    role: string,
    dto: UpdateRolePermissionsDto,
  ) {
    assertConfigurableRole(role);
    const workspace = await this.requireOwner(userId, slug);
    const patch = normalisePermissionPatch(dto.permissions);
    if (patch.some((item) => item.allowed === null))
      throw new BusinessRuleViolation('Quyền mặc định của role phải là true hoặc false');
    await this.workspaces.setRolePermissions(
      workspace.id,
      role,
      patch as { permission: (typeof WORKSPACE_PERMISSIONS)[number]; allowed: boolean }[],
    );
    return this.detail(userId, slug);
  }
  async updateMemberPermissions(
    userId: string,
    slug: string,
    memberId: string,
    dto: UpdateMemberPermissionsDto,
  ) {
    const workspace = await this.requireOwner(userId, slug);
    const member = await this.workspaces.findMember(workspace.id, memberId);
    if (!member) throw new NotFound('Không tìm thấy thành viên');
    if (member.role === 'owner') throw new BusinessRuleViolation('Chủ nhóm luôn có toàn bộ quyền');
    await this.workspaces.setMemberPermissions(
      member.id,
      normalisePermissionPatch(dto.permissions),
    );
    return this.memberDetail(userId, slug, memberId);
  }

  async requestJoin(userId: string, slug: string, dto: RequestWorkspaceJoinDto) {
    const workspace = await this.requireActive(slug);
    const existing = await this.workspaces.findMembershipAny(workspace.id, userId);
    if (existing?.status === 'active') return { status: 'joined', workspaceSlug: slug };
    // A slug is not an invitation credential. Private workspaces may only be
    // joined through their invite code and must never leak through discovery.
    if (workspace.privacy !== 'public') throw new NotFound('Không tìm thấy nhóm học tập');
    if (workspace.joinPolicy === 'invite_only')
      throw new NotAuthorized('Nhóm này chỉ nhận thành viên bằng mã mời');
    if (workspace.joinPolicy === 'open') {
      await this.admit(workspace.id, userId);
      return { status: 'joined', workspaceSlug: slug };
    }
    const request = await this.workspaces.upsertJoinRequest(workspace.id, userId, dto.message);
    return { status: request.status, requestId: request.id, workspaceSlug: slug };
  }
  async joinRequests(
    userId: string,
    slug: string,
    status: 'pending' | 'rejected' | 'all' = 'pending',
  ) {
    const workspace = await this.requireOwner(userId, slug);
    return {
      items: await this.workspaces.listJoinRequests(
        workspace.id,
        status === 'all' ? undefined : status,
      ),
    };
  }
  async reviewJoinRequest(
    userId: string,
    slug: string,
    requestId: string,
    decision: 'approved' | 'rejected',
  ) {
    const workspace = await this.requireOwner(userId, slug);
    const request = await this.workspaces.findJoinRequest(workspace.id, requestId);
    if (!request || request.status !== 'pending')
      throw new NotFound('Không tìm thấy yêu cầu đang chờ');
    // A full group keeps the request pending: the owner can free a seat or upgrade, then approve.
    if (decision === 'approved') await this.admit(workspace.id, request.userId);
    await this.workspaces.reviewJoinRequest(request.id, userId, decision);
    const memberExternalId = await this.workspaces.findUserExternalId(request.userId);
    if (memberExternalId) {
      try {
        await this.events.publish(TOPICS.WORKSPACE_JOIN_REVIEWED, {
          groupId: workspace.id,
          workspaceSlug: workspace.slug,
          workspaceName: workspace.name,
          memberExternalId,
          decision,
        });
      } catch (error) {
        // The membership decision is authoritative in PostgreSQL. A temporary Kafka
        // outage must not turn an approved request back into an HTTP error for the owner.
        this.logger.error('Không phát được thông báo kết quả duyệt thành viên', error as Error);
      }
    }
    return { status: decision };
  }

  async invite(userId: string, slug: string, handle: string) {
    const workspace = await this.requireOwner(userId, slug);
    const user = await this.workspaces.findUserByHandle(handle.trim());
    if (!user) throw new NotFound('Không tìm thấy người dùng');
    if (user.id === userId) throw new BusinessRuleViolation('Bạn đã là Chủ nhóm');
    const existing = await this.workspaces.findMembershipAny(workspace.id, user.id);
    if (existing?.status === 'active') throw new AlreadyExists('Thành viên');
    const { entitlements } = await this.quota.snapshot(workspace.ownerId);
    assertWithinQuota(memberSeatProblem(entitlements, workspace.memberCount));
    if (existing) {
      await this.workspaces.updateMember(existing.id, { status: 'invited', role: 'member' });
      return { invitationId: existing.id, user };
    }
    const invitation = await this.workspaces.createMember(
      workspace.id,
      user.id,
      'member',
      'invited',
    );
    return { invitationId: invitation.id, user };
  }
  async invitations(userId: string, slug: string, query: ListMembersQueryDto) {
    const workspace = await this.requireOwner(userId, slug);
    const page = Math.max(query.page ?? 1, 1);
    const limit = clamp(query.limit, 20, 100);
    const result = await this.workspaces.listMembers(workspace.id, {
      q: (query.search ?? query.q)?.trim() || undefined,
      page,
      limit,
      status: 'invited',
    });
    return {
      items: result.items.map((member) => ({
        id: member.id,
        user: member.user,
        role: member.role,
        invitedAt: member.joinedAt,
      })),
      page,
      limit,
      total: result.total,
      totalPages: Math.ceil(result.total / limit),
    };
  }
  async acceptInvitation(userId: string, slug: string, invitationId: string) {
    const workspace = await this.requireActive(slug);
    const invitation = await this.workspaces.findMember(workspace.id, invitationId, 'invited');
    if (!invitation || invitation.userId !== userId) throw new NotFound('Không tìm thấy lời mời');
    await this.admit(workspace.id, userId);
    return this.detail(userId, slug);
  }
  async revokeInvitation(userId: string, slug: string, invitationId: string) {
    const workspace = await this.requireOwner(userId, slug);
    const invitation = await this.workspaces.findMember(workspace.id, invitationId, 'invited');
    if (!invitation) throw new NotFound('Không tìm thấy lời mời');
    await this.workspaces.updateMember(invitation.id, { status: 'removed' });
    return { revoked: true };
  }

  /**
   * Tư cách xem danh sách và hồ sơ thành viên. Admin xem nhóm để kiểm duyệt (xem `detail`) được
   * coi như một thành viên thường: chỉ thông tin công khai, không quyền quản lý.
   */
  /** The only way a membership becomes active: atomic seat check under the group lock. */
  /** The owner's plan as it applies to one group: its features and any over-limit restriction. */
  async groupPlan(ownerId: string, groupId: string) {
    const [{ entitlements, usage }, overage] = await Promise.all([this.quota.snapshot(ownerId), this.quota.overage(ownerId)]);
    let restriction: GroupRestriction | null = null;
    if (overage) {
      const reasons = overLimitGroups(entitlements, usage, await this.quota.ownedGroups(ownerId)).get(groupId);
      if (reasons) restriction = { ...overageTimeline(overage.overSince, overage.policy), reasons };
    }
    return { name: entitlements.planName, features: entitlements.features, restriction };
  }

  private async admit(groupId: string, userId: string) {
    const membershipId = await this.quota.admitMember(groupId, userId, (entitlements, active) =>
      assertWithinQuota(memberSeatProblem(entitlements, active)),
    );
    await this.workspaces.recordActivity(groupId, userId, 'đã tham gia nhóm học tập', 'membership', membershipId);
    return membershipId;
  }

  private async viewer(workspaceId: string, userId: string): Promise<{ role: WorkspaceRole }> {
    const membership = await this.workspaces.findMembership(workspaceId, userId);
    if (membership) return membership;
    if (await this.workspaces.isPlatformAdmin(userId)) return { role: 'member' };
    throw new NotFound('Không tìm thấy nhóm học tập');
  }

  private async requireActive(slug: string) {
    const workspace = await this.workspaces.findActiveBySlug(slug);
    if (!workspace) throw new NotFound('Không tìm thấy nhóm học tập');
    return workspace;
  }
  private async requireOwner(userId: string, slug: string) {
    const workspace = await this.requireActive(slug);
    assertCanManageWorkspace(workspace.ownerId === userId ? 'owner' : 'member');
    return workspace;
  }
}
function clamp(value: number | undefined, fallback: number, max: number) {
  return Math.min(Math.max(value ?? fallback, 1), max);
}
function trimOptional(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value.trim() || null;
}
function slugify(value: string) {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 56) || 'nhom-hoc-tap'
  );
}
function randomSuffix(length: number) {
  return randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);
}
function randomInviteCode() {
  return randomBytes(5).toString('hex').toUpperCase();
}
function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
function publicUser(user: { id: string; displayName: string; avatarUrl: string | null }) {
  return { id: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl };
}
function endOfDay(value: Date) {
  const result = new Date(value);
  result.setUTCHours(23, 59, 59, 999);
  return result;
}

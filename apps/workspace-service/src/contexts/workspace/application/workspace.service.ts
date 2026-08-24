import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { AlreadyExists, BusinessRuleViolation, NotAuthorized, NotFound } from '@codementor/kernel';
import {
  assertCanManageWorkspace,
  assertConfigurableRole,
  normalisePermissionPatch,
  resolveWorkspacePermissions,
  rolePermissionsFor,
  WORKSPACE_PERMISSIONS,
} from '../domain/model/workspace-policy';
import {
  WORKSPACE_REPOSITORY,
  type WorkspaceRepository,
} from '../domain/port/workspace.repository';
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
  constructor(@Inject(WORKSPACE_REPOSITORY) private readonly workspaces: WorkspaceRepository) {}

  async list(userId: string, query: ListWorkspacesQueryDto) {
    const limit = clamp(query.limit, DEFAULT_LIMIT, 50);
    const page = Math.max(query.page ?? 1, 1);
    const result = await this.workspaces.listForUser(userId, {
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
    if (!data?.membership) throw new NotFound('Không tìm thấy nhóm học tập');
    const permissions = resolveWorkspacePermissions(
      data.membership.role,
      data.rolePermissions,
      data.memberOverrides,
    );
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
        id: data.membership.id,
        role: data.membership.role,
        joinedAt: data.membership.joinedAt,
        permissions,
      },
      inviteCode: data.membership.role === 'owner' ? data.inviteCode : null,
      rolePermissions:
        data.membership.role === 'owner'
          ? {
              deputy: rolePermissionsFor('deputy', data.rolePermissions),
              member: rolePermissionsFor('member', data.rolePermissions),
            }
          : null,
    };
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
        });
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
    let membershipId = existing?.id;
    if (existing)
      await this.workspaces.updateMember(existing.id, {
        status: 'active',
        role: 'member',
        joinedAt: new Date(),
      });
    else membershipId = (await this.workspaces.createMember(workspace.id, userId)).id;
    await this.workspaces.refreshMemberCount(workspace.id);
    await this.workspaces.recordActivity(
      workspace.id,
      userId,
      'đã tham gia nhóm học tập',
      'membership',
      membershipId,
    );
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
    const requester = await this.workspaces.findMembership(workspace.id, userId);
    if (!requester) throw new NotFound('Không tìm thấy nhóm học tập');
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
    const requester = await this.workspaces.findMembership(workspace.id, userId);
    if (!requester) throw new NotFound('Không tìm thấy nhóm học tập');
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
  async removeMember(userId: string, slug: string, memberId: string) {
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
    await this.workspaces.updateMember(target.id, { status: 'removed' });
    await this.workspaces.refreshMemberCount(workspace.id);
    return { removed: true };
  }
  async transferOwnership(userId: string, slug: string, dto: TransferOwnershipDto) {
    const workspace = await this.requireOwner(userId, slug);
    const target = await this.workspaces.findMember(workspace.id, dto.memberId);
    if (!target) throw new NotFound('Người nhận quyền phải là thành viên đang hoạt động');
    if (target.userId === userId) throw new BusinessRuleViolation('Bạn đang là Chủ nhóm');
    await this.workspaces.transferOwnership(workspace.id, userId, target.id, target.userId);
    return { transferred: true };
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
    if (workspace.joinPolicy === 'invite_only')
      throw new NotAuthorized('Nhóm này chỉ nhận thành viên bằng mã mời');
    if (workspace.joinPolicy === 'open') {
      let membershipId = existing?.id;
      if (existing)
        await this.workspaces.updateMember(existing.id, {
          status: 'active',
          role: 'member',
          joinedAt: new Date(),
        });
      else membershipId = (await this.workspaces.createMember(workspace.id, userId)).id;
      await this.workspaces.refreshMemberCount(workspace.id);
      await this.workspaces.recordActivity(
        workspace.id,
        userId,
        'đã tham gia nhóm học tập',
        'membership',
        membershipId,
      );
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
    if (decision === 'approved') {
      const existing = await this.workspaces.findMembershipAny(workspace.id, request.userId);
      let membershipId = existing?.id;
      if (existing)
        await this.workspaces.updateMember(existing.id, {
          status: 'active',
          role: 'member',
          joinedAt: new Date(),
        });
      else membershipId = (await this.workspaces.createMember(workspace.id, request.userId)).id;
      await this.workspaces.refreshMemberCount(workspace.id);
      await this.workspaces.recordActivity(
        workspace.id,
        request.userId,
        'đã tham gia nhóm học tập',
        'membership',
        membershipId,
      );
    }
    await this.workspaces.reviewJoinRequest(request.id, userId, decision);
    return { status: decision };
  }

  async invite(userId: string, slug: string, handle: string) {
    const workspace = await this.requireOwner(userId, slug);
    const user = await this.workspaces.findUserByHandle(handle.trim());
    if (!user) throw new NotFound('Không tìm thấy người dùng');
    if (user.id === userId) throw new BusinessRuleViolation('Bạn đã là Chủ nhóm');
    const existing = await this.workspaces.findMembershipAny(workspace.id, user.id);
    if (existing?.status === 'active') throw new AlreadyExists('Thành viên');
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
    await this.workspaces.updateMember(invitation.id, { status: 'active', joinedAt: new Date() });
    await this.workspaces.refreshMemberCount(workspace.id);
    await this.workspaces.recordActivity(
      workspace.id,
      userId,
      'đã tham gia nhóm học tập',
      'membership',
      invitation.id,
    );
    return this.detail(userId, slug);
  }
  async revokeInvitation(userId: string, slug: string, invitationId: string) {
    const workspace = await this.requireOwner(userId, slug);
    const invitation = await this.workspaces.findMember(workspace.id, invitationId, 'invited');
    if (!invitation) throw new NotFound('Không tìm thấy lời mời');
    await this.workspaces.updateMember(invitation.id, { status: 'removed' });
    return { revoked: true };
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

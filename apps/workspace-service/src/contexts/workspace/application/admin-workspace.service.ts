import { Inject, Injectable, Logger } from '@nestjs/common';
import { BusinessRuleViolation, NotAuthorized, NotFound } from '@codementor/kernel';
import { TOPICS } from '@codementor/contracts';
import { EVENT_BUS, type EventBus } from '@codementor/messaging';
import type { AuthenticatedUser } from '@codementor/platform';
import {
  WORKSPACE_REPOSITORY,
  type WorkspaceRepository,
} from '../domain/port/workspace.repository';
import type {
  AdminListWorkspacesQueryDto,
  ListMembersQueryDto,
} from '../presentation/dto/workspace.dto';

/**
 * Quản trị nhóm học tập ở phạm vi toàn nền tảng. Khác `WorkspaceService` ở chỗ không đi qua
 * membership: admin không phải thành viên của nhóm mà họ xử lý.
 *
 * Kiểm vai trò lại ở đây dù controller đã có `@Roles('admin')`: guard bảo vệ đường HTTP,
 * use case là thứ mọi lối gọi khác cũng đi qua.
 */
@Injectable()
export class AdminWorkspaceService {
  private readonly logger = new Logger(AdminWorkspaceService.name);

  constructor(
    @Inject(WORKSPACE_REPOSITORY) private readonly workspaces: WorkspaceRepository,
    @Inject(EVENT_BUS) private readonly events: EventBus,
  ) {}

  async list(user: AuthenticatedUser, query: AdminListWorkspacesQueryDto) {
    requireAdmin(user);
    const page = Math.max(query.page ?? 1, 1);
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const result = await this.workspaces.listAll({
      q: query.q?.trim() || undefined,
      status: query.status,
      privacy: query.privacy,
      page,
      limit,
    });
    return {
      items: result.items.map(toAdminWorkspace),
      page,
      limit,
      total: result.total,
      totalPages: Math.ceil(result.total / limit),
    };
  }

  summary(user: AuthenticatedUser) {
    requireAdmin(user);
    return this.workspaces.adminSummary();
  }

  async detail(user: AuthenticatedUser, id: string, query: ListMembersQueryDto) {
    requireAdmin(user);
    const workspace = await this.mustFind(id);
    const page = Math.max(query.page ?? 1, 1);
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const members = await this.workspaces.listMembers(workspace.id, {
      q: (query.search ?? query.q)?.trim() || undefined,
      role: query.role,
      page,
      limit,
    });
    return {
      ...toAdminWorkspace(workspace),
      description: workspace.description,
      inviteCode: workspace.inviteCode,
      members: {
        items: members.items.map((member) => ({
          id: member.id,
          user: member.user,
          role: member.role,
          joinedAt: member.joinedAt,
        })),
        page,
        limit,
        total: members.total,
        totalPages: Math.ceil(members.total / limit),
      },
    };
  }

  async setStatus(
    user: AuthenticatedUser,
    id: string,
    status: 'active' | 'archived',
    reason?: string,
  ) {
    const adminId = requireAdmin(user);
    const workspace = await this.mustFind(id);
    if (workspace.status === status) return { status };
    await this.workspaces.update(workspace.id, { status });
    await this.workspaces.recordActivity(
      workspace.id,
      adminId,
      [
        status === 'archived' ? 'quản trị viên đã lưu trữ nhóm' : 'quản trị viên đã khôi phục nhóm',
        reason?.trim(),
      ]
        .filter(Boolean)
        .join(' · '),
      'workspace',
      workspace.id,
    );
    return { status };
  }

  async removeMember(user: AuthenticatedUser, id: string, memberId: string, rawReason: string) {
    const adminId = requireAdmin(user);
    const workspace = await this.mustFind(id);
    const target = await this.workspaces.findMember(workspace.id, memberId);
    if (!target) throw new NotFound('Không tìm thấy thành viên');
    // Nhóm không có chủ thì không ai quản lý được nữa; đổi chủ là việc của chủ nhóm.
    if (target.role === 'owner') throw new BusinessRuleViolation('Không thể xoá Chủ nhóm');
    const reason = rawReason.trim();
    if (!reason) throw new BusinessRuleViolation('Vui lòng nhập lý do xóa thành viên khỏi nhóm');

    await this.workspaces.updateMember(target.id, { status: 'removed' });
    await this.workspaces.refreshMemberCount(workspace.id);
    await this.workspaces.recordActivity(
      workspace.id,
      adminId,
      `quản trị viên đã xóa thành viên khỏi nhóm · ${reason}`,
      'membership',
      target.id,
    );
    try {
      await this.events.publish(TOPICS.WORKSPACE_ACTIVITY, {
        groupId: workspace.id,
        entityId: target.id,
        action: 'member_removed',
        actorUserId: adminId,
        memberUserId: target.userId,
        reason,
      });
    } catch (error) {
      this.logger.error('Không phát được thông báo xóa thành viên', error as Error);
    }
    return { removed: true };
  }

  private async mustFind(id: string) {
    const workspace = await this.workspaces.findByIdWithOwner(id);
    if (!workspace) throw new NotFound('Không tìm thấy nhóm học tập');
    return workspace;
  }
}

function requireAdmin(user: AuthenticatedUser): string {
  if (user.role !== 'admin' || user.actorType !== 'human' || !user.id) {
    throw new NotAuthorized('quản trị nhóm học tập');
  }
  return user.id;
}

function toAdminWorkspace(
  row: Awaited<ReturnType<WorkspaceRepository['listAll']>>['items'][number],
) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    topic: row.topic,
    status: row.status,
    privacy: row.privacy,
    joinPolicy: row.joinPolicy,
    memberCount: row.memberCount,
    avatarUrl: row.avatarUrl,
    owner: row.owner,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastActivityAt: row.lastActivityAt,
  };
}

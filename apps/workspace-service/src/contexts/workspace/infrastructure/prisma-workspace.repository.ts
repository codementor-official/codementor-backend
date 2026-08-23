import { Injectable } from '@nestjs/common';
import { assignment_status, exercise_status, group_permission, group_role, group_status, member_status, Prisma } from '@prisma/client';
import { PrismaService } from '@codementor/platform';
import { DEFAULT_ROLE_PERMISSIONS, type ConfigurableWorkspaceRole, type WorkspacePermission, type WorkspaceRole } from '../domain/model/workspace-policy';
import type { MemberListFilter, MembershipRecord, WorkspaceDetailRecord, WorkspaceListFilter, WorkspaceListRecord, WorkspaceMemberRecord, WorkspaceRecord, WorkspaceRepository, WorkspaceUser } from '../domain/port/workspace.repository';

const ALL_PERMISSIONS = Object.values(group_permission) as WorkspacePermission[];

/** Adapter duy nhất của context Workspace biết Prisma/PostgreSQL và schema vật lý. */
@Injectable()
export class PrismaWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string, filter: WorkspaceListFilter): Promise<WorkspaceListRecord[]> {
    const membership: Prisma.group_membersWhereInput = { user_id: userId, status: member_status.active };
    if (filter.scope === 'owned') membership.role = group_role.owner;
    if (filter.scope === 'joined') membership.role = { in: [group_role.deputy, group_role.member] };
    const where: Prisma.study_groupsWhereInput = { status: group_status.active, group_members: { some: membership } };
    const and: Prisma.study_groupsWhereInput[] = [];
    if (filter.topic) where.topic = { equals: filter.topic, mode: 'insensitive' };
    if (filter.q) and.push({ OR: [{ name: { contains: filter.q, mode: 'insensitive' } }, { description: { contains: filter.q, mode: 'insensitive' } }, { topic: { contains: filter.q, mode: 'insensitive' } }] });
    if (filter.cursor) and.push({ OR: [{ updated_at: { lt: filter.cursor.updatedAt } }, { updated_at: filter.cursor.updatedAt, id: { lt: filter.cursor.id } }] });
    if (and.length) where.AND = and;
    const rows = await this.prisma.study_groups.findMany({
      where, orderBy: [{ updated_at: 'desc' }, { id: 'desc' }], take: filter.limit + 1,
      include: { users: { select: { id: true, display_name: true, avatar_url: true } }, group_members: { where: { status: member_status.active }, orderBy: { joined_at: 'asc' }, take: 4, include: { users: { select: { id: true, display_name: true, avatar_url: true } } } } },
    });
    const groupIds = rows.map((row) => row.id);
    const [roles, assignments, exercises] = await Promise.all([
      this.prisma.group_members.findMany({ where: { group_id: { in: groupIds }, user_id: userId, status: member_status.active }, select: { id: true, group_id: true, role: true } }),
      this.prisma.assignments.findMany({ where: { group_id: { in: groupIds } }, select: { group_id: true, member_id: true, status: true } }),
      this.prisma.group_exercises.findMany({ where: { group_id: { in: groupIds }, exercises: { status: exercise_status.published } }, select: { group_id: true, due_at: true } }),
    ]);
    const membershipByGroup = new Map(roles.map((row) => [row.group_id, row]));
    const now = new Date();
    return rows.map((row) => {
      const membership = membershipByGroup.get(row.id);
      const relevantAssignments = assignments.filter((assignment) => assignment.group_id === row.id && (membership?.role === group_role.owner || assignment.member_id === membership?.id));
      const completed = relevantAssignments.filter((assignment) => assignment.status === assignment_status.done || assignment.status === assignment_status.late).length;
      return { ...this.toWorkspace(row), owner: this.toUser(row.users), role: membership?.role ?? 'member', memberPreview: row.group_members.map((member) => this.toUser(member.users)), openTaskCount: exercises.filter((exercise) => exercise.group_id === row.id && (!exercise.due_at || exercise.due_at >= now)).length, progressPercent: relevantAssignments.length === 0 ? 0 : Math.round(completed / relevantAssignments.length * 100) };
    });
  }

  async summaryForUser(userId: string) {
    // Danh sách chỉ trả group active; summary phải dùng chính predicate này để StatStrip
    // không đếm một membership còn tồn tại trong group đã archive.
    const active = { status: member_status.active, user_id: userId, study_groups: { is: { status: group_status.active } } };
    const [total, owned, joined] = await Promise.all([
      this.prisma.group_members.count({ where: active }),
      this.prisma.group_members.count({ where: { ...active, role: group_role.owner } }),
      this.prisma.group_members.count({ where: { ...active, role: { in: [group_role.deputy, group_role.member] } } }),
    ]);
    return { total, owned, joined };
  }

  async findDetail(slug: string, userId: string): Promise<WorkspaceDetailRecord | null> {
    const row = await this.prisma.study_groups.findUnique({ where: { slug }, include: {
      users: { select: { id: true, display_name: true, avatar_url: true } },
      group_members: { where: { user_id: userId, status: member_status.active }, include: { group_member_permissions: { select: { permission: true, allowed: true } } } },
      group_role_permissions: { select: { role: true, permission: true, allowed: true } },
    } });
    if (!row || row.status !== group_status.active) return null;
    const membership = row.group_members[0];
    return { ...this.toWorkspace(row), owner: this.toUser(row.users), membership: membership ? this.toMembership(membership) : null, rolePermissions: row.group_role_permissions.map((item) => ({ role: item.role, permission: item.permission, allowed: item.allowed })), memberOverrides: membership?.group_member_permissions.map((item) => ({ permission: item.permission, allowed: item.allowed })) ?? [] };
  }

  async findActiveBySlug(slug: string) { const row = await this.prisma.study_groups.findUnique({ where: { slug } }); return row?.status === group_status.active ? this.toWorkspace(row) : null; }
  async findActiveByInviteCode(inviteCode: string) { const row = await this.prisma.study_groups.findUnique({ where: { invite_code: inviteCode } }); return row?.status === group_status.active ? this.toWorkspace(row) : null; }

  async create(input: { slug: string; inviteCode: string; name: string; description: string | null | undefined; topic: string | null | undefined; ownerId: string }) {
    const created = await this.prisma.$transaction(async (tx) => {
      const workspace = await tx.study_groups.create({ data: { slug: input.slug, invite_code: input.inviteCode, name: input.name, description: input.description, topic: input.topic, owner_id: input.ownerId } });
      await tx.group_members.create({ data: { group_id: workspace.id, user_id: input.ownerId, role: group_role.owner } });
      await tx.group_role_permissions.createMany({ data: ([group_role.deputy, group_role.member] as const).flatMap((role) => ALL_PERMISSIONS.map((permission) => ({ group_id: workspace.id, role, permission, allowed: DEFAULT_ROLE_PERMISSIONS[role][permission] ?? false }))) });
      return workspace;
    });
    return this.toWorkspace(created);
  }

  async update(id: string, input: { name?: string; description?: string | null; topic?: string | null; status?: 'archived'; inviteCode?: string }) {
    await this.prisma.study_groups.update({ where: { id }, data: { name: input.name, description: input.description, topic: input.topic, status: input.status as group_status | undefined, invite_code: input.inviteCode } });
  }

  async findMembership(groupId: string, userId: string, status: 'active' | 'invited' = 'active') { const row = await this.prisma.group_members.findFirst({ where: { group_id: groupId, user_id: userId, status: status as member_status } }); return row ? this.toMembership(row) : null; }
  async findMembershipAny(groupId: string, userId: string) { const row = await this.prisma.group_members.findUnique({ where: { group_id_user_id: { group_id: groupId, user_id: userId } } }); return row ? this.toMembership(row) : null; }
  async findMember(groupId: string, memberId: string, status: 'active' | 'invited' = 'active') { const row = await this.prisma.group_members.findFirst({ where: { id: memberId, group_id: groupId, status: status as member_status } }); return row ? this.toMembership(row) : null; }

  async findMembershipWithPermissions(groupId: string, userId: string) {
    const row = await this.prisma.group_members.findFirst({ where: { group_id: groupId, user_id: userId, status: member_status.active }, include: { group_member_permissions: { select: { permission: true, allowed: true } }, study_groups: { include: { group_role_permissions: { select: { role: true, permission: true, allowed: true } } } } } });
    return row ? { ...this.toMembership(row), rolePermissions: row.study_groups.group_role_permissions.map((item) => ({ role: item.role, permission: item.permission, allowed: item.allowed })), memberOverrides: row.group_member_permissions.map((item) => ({ permission: item.permission, allowed: item.allowed })) } : null;
  }

  async createMember(groupId: string, userId: string, role: WorkspaceRole = 'member', status: 'invited' | 'active' = 'active') { const row = await this.prisma.group_members.create({ data: { group_id: groupId, user_id: userId, role: role as group_role, status: status as member_status } }); return this.toMembership(row); }
  async updateMember(id: string, input: Partial<Pick<MembershipRecord, 'role' | 'status' | 'joinedAt'>>) { await this.prisma.group_members.update({ where: { id }, data: { role: input.role as group_role | undefined, status: input.status as member_status | undefined, joined_at: input.joinedAt } }); }

  async listMembers(groupId: string, filter: MemberListFilter): Promise<WorkspaceMemberRecord[]> {
    const where: Prisma.group_membersWhereInput = { group_id: groupId, status: (filter.status ?? 'active') as member_status };
    if (filter.role) where.role = filter.role as group_role;
    if (filter.q) where.users = { is: { OR: [{ display_name: { contains: filter.q, mode: 'insensitive' } }, { handle: { contains: filter.q, mode: 'insensitive' } }] } };
    if (filter.cursor) where.AND = [{ OR: [{ joined_at: { gt: filter.cursor.updatedAt } }, { joined_at: filter.cursor.updatedAt, id: { gt: filter.cursor.id } }] }];
    const rows = await this.prisma.group_members.findMany({ where, orderBy: [{ joined_at: 'asc' }, { id: 'asc' }], take: filter.limit + 1, include: { users: { select: { id: true, display_name: true, avatar_url: true, handle: true } } } });
    return rows.map((row) => ({ ...this.toMembership(row), user: this.toUser(row.users) }));
  }

  async transferOwnership(groupId: string, oldOwnerId: string, newOwnerMembershipId: string, newOwnerId: string) { await this.prisma.$transaction(async (tx) => { await tx.group_members.updateMany({ where: { group_id: groupId, user_id: oldOwnerId, role: group_role.owner }, data: { role: group_role.deputy } }); await tx.group_members.update({ where: { id: newOwnerMembershipId }, data: { role: group_role.owner } }); await tx.study_groups.update({ where: { id: groupId }, data: { owner_id: newOwnerId } }); }); }
  async setRolePermissions(groupId: string, role: ConfigurableWorkspaceRole, permissions: { permission: WorkspacePermission; allowed: boolean }[]) { await this.prisma.$transaction(permissions.map(({ permission, allowed }) => this.prisma.group_role_permissions.upsert({ where: { group_id_role_permission: { group_id: groupId, role: role as group_role, permission: permission as group_permission } }, create: { group_id: groupId, role: role as group_role, permission: permission as group_permission, allowed }, update: { allowed } }))); }
  async setMemberPermissions(memberId: string, permissions: { permission: WorkspacePermission; allowed: boolean }[]) { await this.prisma.$transaction(permissions.map(({ permission, allowed }) => this.prisma.group_member_permissions.upsert({ where: { group_member_id_permission: { group_member_id: memberId, permission: permission as group_permission } }, create: { group_member_id: memberId, permission: permission as group_permission, allowed }, update: { allowed } }))); }
  async findUserByHandle(handle: string) { const user = await this.prisma.users.findUnique({ where: { handle }, select: { id: true, display_name: true, avatar_url: true, handle: true } }); return user ? this.toUser(user) : null; }

  private toWorkspace(row: { id: string; slug: string; name: string; description: string | null; topic: string | null; status: group_status; owner_id: string; invite_code: string; member_count: number; created_at: Date; updated_at: Date; last_activity_at: Date | null }): WorkspaceRecord { return { id: row.id, slug: row.slug, name: row.name, description: row.description, topic: row.topic, status: row.status, ownerId: row.owner_id, inviteCode: row.invite_code, memberCount: row.member_count, createdAt: row.created_at, updatedAt: row.updated_at, lastActivityAt: row.last_activity_at }; }
  private toMembership(row: { id: string; group_id: string; user_id: string; role: group_role; status: member_status; joined_at: Date }): MembershipRecord { return { id: row.id, groupId: row.group_id, userId: row.user_id, role: row.role, status: row.status, joinedAt: row.joined_at }; }
  private toUser(row: { id: string; display_name: string; avatar_url: string | null; handle?: string | null }): WorkspaceUser { return { id: row.id, displayName: row.display_name, avatarUrl: row.avatar_url, handle: row.handle ?? undefined }; }
}

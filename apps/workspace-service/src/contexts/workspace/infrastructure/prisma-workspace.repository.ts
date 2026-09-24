import { Injectable } from '@nestjs/common';
import {
  assignment_status,
  exercise_status,
  group_permission,
  group_role,
  group_status,
  join_request_status,
  member_status,
  Prisma,
  workspace_join_policy,
  workspace_privacy,
} from '@prisma/client';
import { PrismaService } from '@codementor/platform';
import {
  DEFAULT_ROLE_PERMISSIONS,
  type ConfigurableWorkspaceRole,
  type WorkspacePermission,
  type WorkspaceRole,
} from '../domain/model/workspace-policy';
import type {
  AdminWorkspaceListFilter,
  MemberListFilter,
  MembershipRecord,
  WorkspaceDetailRecord,
  WorkspaceListFilter,
  WorkspaceMemberRecord,
  WorkspaceRecord,
  WorkspaceRepository,
  WorkspaceUser,
} from '../domain/port/workspace.repository';

const ALL_PERMISSIONS = Object.values(group_permission) as WorkspacePermission[];

/** Adapter duy nhất của context Workspace biết Prisma/PostgreSQL và schema vật lý. */
@Injectable()
export class PrismaWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string, filter: WorkspaceListFilter) {
    const membership: Prisma.group_membersWhereInput = {
      user_id: userId,
      status: member_status.active,
    };
    const where: Prisma.study_groupsWhereInput = {
      status: group_status.active,
      ...(filter.ids ? { id: { in: filter.ids } } : {}),
    };
    switch (filter.scope ?? 'mine') {
      case 'owned':
        where.group_members = { some: { ...membership, role: group_role.owner } };
        break;
      case 'joined':
        where.group_members = {
          some: { ...membership, role: { in: [group_role.deputy, group_role.member] } },
        };
        break;
      case 'discover':
        where.privacy = workspace_privacy.public;
        where.NOT = { group_members: { some: membership } };
        break;
      case 'public':
        // Public catalogue includes joined groups as well. It powers the global
        // Explore page where the most useful public communities should not
        // disappear just because the current user is already a member.
        where.privacy = workspace_privacy.public;
        break;
      case 'all':
        where.OR = [{ privacy: workspace_privacy.public }, { group_members: { some: membership } }];
        break;
      case 'mine':
      default:
        where.group_members = { some: membership };
        break;
    }
    const and: Prisma.study_groupsWhereInput[] = [];
    if (filter.topic) where.topic = { equals: filter.topic, mode: 'insensitive' };
    if (filter.q)
      and.push({
        OR: [
          { name: { contains: filter.q, mode: 'insensitive' } },
          { description: { contains: filter.q, mode: 'insensitive' } },
          { topic: { contains: filter.q, mode: 'insensitive' } },
        ],
      });
    if (and.length) where.AND = and;
    const publicRanking = filter.scope === 'public' || filter.scope === 'discover';
    const [total, rows] = await Promise.all([
      this.prisma.study_groups.count({ where }),
      this.prisma.study_groups.findMany({
        where,
        orderBy: publicRanking
          ? [
              { member_count: 'desc' },
              { last_activity_at: { sort: 'desc', nulls: 'last' } },
              { updated_at: 'desc' },
              { id: 'desc' },
            ]
          : [{ updated_at: 'desc' }, { id: 'desc' }],
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
        include: {
          users: { select: { id: true, display_name: true, avatar_url: true, email: true } },
          group_members: {
            where: { status: member_status.active },
            orderBy: { joined_at: 'asc' },
            take: 4,
            include: {
              users: {
                select: { id: true, display_name: true, avatar_url: true, email: true },
              },
            },
          },
        },
      }),
    ]);
    const groupIds = rows.map((row) => row.id);
    const [roles, assignments, exercises, unreadRows] = await Promise.all([
      this.prisma.group_members.findMany({
        where: { group_id: { in: groupIds }, user_id: userId, status: member_status.active },
        select: { id: true, group_id: true, role: true },
      }),
      this.prisma.assignments.findMany({
        where: { group_id: { in: groupIds } },
        select: { group_id: true, member_id: true, status: true },
      }),
      this.prisma.group_exercises.findMany({
        where: { group_id: { in: groupIds }, exercises: { status: exercise_status.published } },
        select: { group_id: true, due_at: true },
      }),
      groupIds.length
        ? this.prisma.$queryRaw<Array<{ groupId: string; count: bigint }>>(Prisma.sql`
            SELECT m.group_id AS "groupId", COUNT(*)::bigint AS count
            FROM workspace_messages m
            JOIN group_members gm
              ON gm.group_id = m.group_id
             AND gm.user_id = ${userId}::uuid
             AND gm.status = 'active'
            LEFT JOIN workspace_message_reads r ON r.group_member_id = gm.id
            WHERE m.group_id IN (${Prisma.join(groupIds.map((id) => Prisma.sql`${id}::uuid`))})
              AND m.sender_id <> ${userId}::uuid
              AND m.deleted_at IS NULL
              AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
            GROUP BY m.group_id
          `)
        : Promise.resolve([]),
    ]);
    const membershipByGroup = new Map(roles.map((row) => [row.group_id, row]));
    const unreadByGroup = new Map(unreadRows.map((row) => [row.groupId, Number(row.count)]));
    const now = new Date();
    return {
      total,
      items: rows.map((row) => {
        const membership = membershipByGroup.get(row.id);
        const relevantAssignments = assignments.filter(
          (assignment) =>
            assignment.group_id === row.id &&
            (membership?.role === group_role.owner || assignment.member_id === membership?.id),
        );
        const completed = relevantAssignments.filter(
          (assignment) =>
            assignment.status === assignment_status.done ||
            assignment.status === assignment_status.late,
        ).length;
        return {
          ...this.toWorkspace(row),
          owner: this.toUser(row.users),
          role: membership?.role ?? null,
          memberPreview: row.group_members.map((member) => this.toUser(member.users)),
          openTaskCount: exercises.filter(
            (exercise) =>
              exercise.group_id === row.id && (!exercise.due_at || exercise.due_at >= now),
          ).length,
          progressPercent:
            relevantAssignments.length === 0
              ? 0
              : Math.round((completed / relevantAssignments.length) * 100),
          unreadCount: unreadByGroup.get(row.id) ?? 0,
        };
      }),
    };
  }

  async listAll(filter: AdminWorkspaceListFilter) {
    const where: Prisma.study_groupsWhereInput = {};
    if (filter.status) where.status = filter.status as group_status;
    if (filter.privacy) where.privacy = filter.privacy as workspace_privacy;
    if (filter.q)
      where.OR = [
        { name: { contains: filter.q, mode: 'insensitive' } },
        { slug: { contains: filter.q, mode: 'insensitive' } },
        { topic: { contains: filter.q, mode: 'insensitive' } },
        { users: { is: { email: { contains: filter.q, mode: 'insensitive' } } } },
        { users: { is: { display_name: { contains: filter.q, mode: 'insensitive' } } } },
      ];
    const [total, rows] = await Promise.all([
      this.prisma.study_groups.count({ where }),
      this.prisma.study_groups.findMany({
        where,
        orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
        include: {
          users: { select: { id: true, display_name: true, avatar_url: true, email: true } },
        },
      }),
    ]);
    return {
      total,
      items: rows.map((row) => ({ ...this.toWorkspace(row), owner: this.toUser(row.users) })),
    };
  }

  async adminSummary() {
    const [byStatus, byPrivacy] = await Promise.all([
      this.prisma.study_groups.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.study_groups.groupBy({ by: ['privacy'], _count: { _all: true } }),
    ]);
    const count = <T>(rows: Array<{ _count: { _all: number } } & T>, match: (row: T) => boolean) =>
      rows.find(match)?._count._all ?? 0;
    const active = count(byStatus, (row) => row.status === group_status.active);
    const archived = count(byStatus, (row) => row.status === group_status.archived);
    return {
      total: active + archived,
      active,
      archived,
      public: count(byPrivacy, (row) => row.privacy === workspace_privacy.public),
      private: count(byPrivacy, (row) => row.privacy === workspace_privacy.private),
    };
  }

  async findByIdWithOwner(id: string) {
    const row = await this.prisma.study_groups.findUnique({
      where: { id },
      include: {
        users: { select: { id: true, display_name: true, avatar_url: true, email: true } },
      },
    });
    return row ? { ...this.toWorkspace(row), owner: this.toUser(row.users) } : null;
  }

  async summaryForUser(userId: string) {
    // Danh sách chỉ trả group active; summary phải dùng chính predicate này để StatStrip
    // không đếm một membership còn tồn tại trong group đã archive.
    const active = {
      status: member_status.active,
      user_id: userId,
      study_groups: { is: { status: group_status.active } },
    };
    const [total, owned, joined, unreadRows] = await Promise.all([
      this.prisma.group_members.count({ where: active }),
      this.prisma.group_members.count({ where: { ...active, role: group_role.owner } }),
      this.prisma.group_members.count({
        where: { ...active, role: { in: [group_role.deputy, group_role.member] } },
      }),
      this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM workspace_messages m
        JOIN group_members gm
          ON gm.group_id = m.group_id
         AND gm.user_id = ${userId}::uuid
         AND gm.status = 'active'
        JOIN study_groups g ON g.id = gm.group_id AND g.status = 'active'
        LEFT JOIN workspace_message_reads r ON r.group_member_id = gm.id
        WHERE m.sender_id <> ${userId}::uuid
          AND m.deleted_at IS NULL
          AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
      `),
    ]);
    return { total, owned, joined, unreadCount: Number(unreadRows[0]?.count ?? 0n) };
  }

  async findDetail(slug: string, userId: string): Promise<WorkspaceDetailRecord | null> {
    const row = await this.prisma.study_groups.findUnique({
      where: { slug },
      include: {
        users: { select: { id: true, display_name: true, avatar_url: true, email: true } },
        group_members: {
          where: { user_id: userId, status: member_status.active },
          include: { group_member_permissions: { select: { permission: true, allowed: true } } },
        },
        group_role_permissions: { select: { role: true, permission: true, allowed: true } },
      },
    });
    if (!row || row.status !== group_status.active) return null;
    const membership = row.group_members[0];
    return {
      ...this.toWorkspace(row),
      owner: this.toUser(row.users),
      membership: membership ? this.toMembership(membership) : null,
      rolePermissions: row.group_role_permissions.map((item) => ({
        role: item.role,
        permission: item.permission,
        allowed: item.allowed,
      })),
      memberOverrides:
        membership?.group_member_permissions.map((item) => ({
          permission: item.permission,
          allowed: item.allowed,
        })) ?? [],
    };
  }

  async findActiveBySlug(slug: string) {
    const row = await this.prisma.study_groups.findUnique({ where: { slug } });
    return row?.status === group_status.active ? this.toWorkspace(row) : null;
  }
  async findActiveByInviteCode(inviteCode: string) {
    const row = await this.prisma.study_groups.findUnique({ where: { invite_code: inviteCode } });
    return row?.status === group_status.active ? this.toWorkspace(row) : null;
  }

  async create(input: {
    slug: string;
    inviteCode: string;
    name: string;
    description: string | null | undefined;
    topic: string | null | undefined;
    ownerId: string;
  }) {
    const created = await this.prisma.$transaction(async (tx) => {
      const workspace = await tx.study_groups.create({
        data: {
          slug: input.slug,
          invite_code: input.inviteCode,
          name: input.name,
          description: input.description,
          topic: input.topic,
          owner_id: input.ownerId,
        },
      });
      await tx.group_members.create({
        data: { group_id: workspace.id, user_id: input.ownerId, role: group_role.owner },
      });
      await tx.group_role_permissions.createMany({
        data: ([group_role.deputy, group_role.member] as const).flatMap((role) =>
          ALL_PERMISSIONS.map((permission) => ({
            group_id: workspace.id,
            role,
            permission,
            allowed: DEFAULT_ROLE_PERMISSIONS[role][permission] ?? false,
          })),
        ),
      });
      return workspace;
    });
    return this.toWorkspace(created);
  }

  async update(
    id: string,
    input: {
      name?: string;
      description?: string | null;
      topic?: string | null;
      status?: 'active' | 'archived';
      inviteCode?: string;
      avatarUrl?: string | null;
      avatarKey?: string | null;
      coverUrl?: string | null;
      coverKey?: string | null;
      coverPosition?: 'top' | 'center' | 'bottom';
      coverFit?: 'cover' | 'contain';
      coverHeight?: 'compact' | 'medium' | 'tall';
      privacy?: 'public' | 'private';
      joinPolicy?: 'open' | 'approval' | 'invite_only';
    },
  ) {
    await this.prisma.study_groups.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        topic: input.topic,
        status: input.status as group_status | undefined,
        invite_code: input.inviteCode,
        avatar_url: input.avatarUrl,
        avatar_key: input.avatarKey,
        cover_url: input.coverUrl,
        cover_key: input.coverKey,
        cover_position: input.coverPosition,
        cover_fit: input.coverFit,
        cover_height: input.coverHeight,
        privacy: input.privacy as workspace_privacy | undefined,
        join_policy: input.joinPolicy as workspace_join_policy | undefined,
      },
    });
  }

  async findMembership(groupId: string, userId: string, status: 'active' | 'invited' = 'active') {
    const row = await this.prisma.group_members.findFirst({
      where: { group_id: groupId, user_id: userId, status: status as member_status },
    });
    return row ? this.toMembership(row) : null;
  }
  async findMembershipAny(groupId: string, userId: string) {
    const row = await this.prisma.group_members.findUnique({
      where: { group_id_user_id: { group_id: groupId, user_id: userId } },
    });
    return row ? this.toMembership(row) : null;
  }
  async findMember(groupId: string, memberId: string, status: 'active' | 'invited' = 'active') {
    const row = await this.prisma.group_members.findFirst({
      where: { id: memberId, group_id: groupId, status: status as member_status },
    });
    return row ? this.toMembership(row) : null;
  }

  async findMembershipWithPermissions(groupId: string, userId: string) {
    const row = await this.prisma.group_members.findFirst({
      where: { group_id: groupId, user_id: userId, status: member_status.active },
      include: {
        group_member_permissions: { select: { permission: true, allowed: true } },
        study_groups: {
          include: {
            group_role_permissions: { select: { role: true, permission: true, allowed: true } },
          },
        },
      },
    });
    return row
      ? {
          ...this.toMembership(row),
          rolePermissions: row.study_groups.group_role_permissions.map((item) => ({
            role: item.role,
            permission: item.permission,
            allowed: item.allowed,
          })),
          memberOverrides: row.group_member_permissions.map((item) => ({
            permission: item.permission,
            allowed: item.allowed,
          })),
        }
      : null;
  }

  async createMember(
    groupId: string,
    userId: string,
    role: WorkspaceRole = 'member',
    status: 'invited' | 'active' = 'active',
  ) {
    const row = await this.prisma.group_members.create({
      data: {
        group_id: groupId,
        user_id: userId,
        role: role as group_role,
        status: status as member_status,
      },
    });
    return this.toMembership(row);
  }
  async updateMember(
    id: string,
    input: Partial<Pick<MembershipRecord, 'role' | 'status' | 'joinedAt'>>,
  ) {
    await this.prisma.group_members.update({
      where: { id },
      data: {
        role: input.role as group_role | undefined,
        status: input.status as member_status | undefined,
        joined_at: input.joinedAt,
      },
    });
  }

  async listMembers(
    groupId: string,
    filter: MemberListFilter,
  ): Promise<{ items: WorkspaceMemberRecord[]; total: number }> {
    const where: Prisma.group_membersWhereInput = {
      group_id: groupId,
      status: (filter.status ?? 'active') as member_status,
    };
    if (filter.role) where.role = filter.role as group_role;
    if (filter.q)
      where.users = {
        is: {
          OR: [
            { display_name: { contains: filter.q, mode: 'insensitive' } },
            { handle: { contains: filter.q, mode: 'insensitive' } },
            { email: { contains: filter.q, mode: 'insensitive' } },
          ],
        },
      };
    if (filter.joinedFrom || filter.joinedTo)
      where.joined_at = { gte: filter.joinedFrom, lte: filter.joinedTo };

    const and: Prisma.group_membersWhereInput[] = [];
    if (filter.progress === 'completed')
      and.push({
        assignments: {
          some: {},
          every: { status: { in: [assignment_status.done, assignment_status.late] } },
        },
      });
    if (filter.progress === 'not_started')
      and.push({
        OR: [
          { assignments: { none: {} } },
          { assignments: { every: { status: assignment_status.notstarted } } },
        ],
      });
    if (filter.progress === 'in_progress')
      and.push(
        { assignments: { some: {} } },
        {
          NOT: {
            assignments: {
              every: { status: { in: [assignment_status.done, assignment_status.late] } },
            },
          },
        },
        { NOT: { assignments: { every: { status: assignment_status.notstarted } } } },
      );
    if (filter.submissionStatus === 'passed')
      and.push({ assignments: { some: { submissions: { some: { verdict: 'accepted' } } } } });
    if (filter.submissionStatus === 'submitted')
      and.push({ assignments: { some: { submissions: { some: {} } } } });
    if (filter.submissionStatus === 'not_submitted')
      and.push({ assignments: { some: {}, every: { submissions: { none: {} } } } });

    if (filter.activityLevel) {
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - 28);
      const activity = await this.prisma.group_activities.groupBy({
        by: ['actor_id'],
        where: { group_id: groupId, actor_id: { not: null }, created_at: { gte: since } },
        _count: { _all: true },
      });
      const activeIds = activity.flatMap((item) =>
        item.actor_id ? [{ id: item.actor_id, count: item._count._all }] : [],
      );
      if (filter.activityLevel === 'high')
        and.push({
          user_id: { in: activeIds.filter((item) => item.count >= 10).map((item) => item.id) },
        });
      if (filter.activityLevel === 'medium')
        and.push({
          user_id: {
            in: activeIds
              .filter((item) => item.count >= 3 && item.count < 10)
              .map((item) => item.id),
          },
        });
      if (filter.activityLevel === 'low')
        and.push({
          user_id: { notIn: activeIds.filter((item) => item.count >= 3).map((item) => item.id) },
        });
    }
    if (and.length) where.AND = and;

    const [total, rows] = await Promise.all([
      this.prisma.group_members.count({ where }),
      this.prisma.group_members.findMany({
        where,
        orderBy: [{ role: 'asc' }, { joined_at: 'asc' }, { id: 'asc' }],
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
        include: {
          users: {
            select: { id: true, display_name: true, avatar_url: true, handle: true, email: true },
          },
        },
      }),
    ]);
    return {
      items: rows.map((row) => ({ ...this.toMembership(row), user: this.toUser(row.users) })),
      total,
    };
  }

  async memberDashboard(groupId: string, memberId: string) {
    const row = await this.prisma.group_members.findFirst({
      where: { id: memberId, group_id: groupId, status: member_status.active },
      include: {
        users: {
          select: {
            id: true,
            display_name: true,
            avatar_url: true,
            handle: true,
            email: true,
            user_stats: true,
          },
        },
        group_member_permissions: { select: { permission: true, allowed: true } },
        study_groups: {
          select: {
            group_role_permissions: { select: { role: true, permission: true, allowed: true } },
          },
        },
        assignments: {
          select: {
            status: true,
            submissions: { select: { verdict: true, score: true, submitted_at: true } },
          },
        },
      },
    });
    if (!row) return null;
    const submissions = row.assignments.flatMap((assignment) => assignment.submissions);
    const scored = submissions.filter((submission) => submission.score !== null);
    const heatmapFrom = new Date();
    heatmapFrom.setUTCDate(heatmapFrom.getUTCDate() - 83);
    heatmapFrom.setUTCHours(0, 0, 0, 0);
    const activities = await this.prisma.group_activities.findMany({
      where: { group_id: groupId, actor_id: row.user_id, created_at: { gte: heatmapFrom } },
      orderBy: { created_at: 'desc' },
    });
    const activityByDate = new Map<string, number>();
    for (const value of [
      ...activities.map((item) => item.created_at),
      ...row.assignments.flatMap((assignment) =>
        assignment.submissions.map((submission) => submission.submitted_at),
      ),
    ]) {
      const key = value.toISOString().slice(0, 10);
      activityByDate.set(key, (activityByDate.get(key) ?? 0) + 1);
    }
    const activityHeatmap = Array.from({ length: 84 }, (_, index) => {
      const date = new Date(heatmapFrom);
      date.setUTCDate(date.getUTCDate() + index);
      const key = date.toISOString().slice(0, 10);
      return { date: key, count: activityByDate.get(key) ?? 0 };
    });
    const lastActivity =
      [
        ...activities.map((item) => item.created_at),
        ...row.assignments.flatMap((assignment) =>
          assignment.submissions.map((submission) => submission.submitted_at),
        ),
      ].sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return {
      ...this.toMembership(row),
      user: this.toUser(row.users),
      xp: row.users.user_stats?.xp ?? 0,
      solvedCount: row.users.user_stats?.solved_count ?? 0,
      currentStreakDays: row.users.user_stats?.current_streak_days ?? 0,
      longestStreakDays: row.users.user_stats?.longest_streak_days ?? 0,
      activeDays: activityHeatmap.filter((item) => item.count > 0).length,
      lastActiveAt: lastActivity,
      activityHeatmap,
      rolePermissions: row.study_groups.group_role_permissions.map((item) => ({
        role: item.role,
        permission: item.permission,
        allowed: item.allowed,
      })),
      memberOverrides: row.group_member_permissions.map((item) => ({
        permission: item.permission,
        allowed: item.allowed,
      })),
      assignmentStats: {
        assigned: row.assignments.length,
        completed: row.assignments.filter(
          (item) =>
            item.status === assignment_status.done || item.status === assignment_status.late,
        ).length,
        inProgress: row.assignments.filter((item) => item.status === assignment_status.inprogress)
          .length,
        notStarted: row.assignments.filter((item) => item.status === assignment_status.notstarted)
          .length,
      },
      submissionStats: {
        total: submissions.length,
        accepted: submissions.filter((item) => item.verdict === 'accepted').length,
        failed: submissions.filter(
          (item) => item.verdict !== 'accepted' && item.verdict !== 'pending',
        ).length,
        averageScore: scored.length
          ? Math.round(scored.reduce((sum, item) => sum + (item.score ?? 0), 0) / scored.length)
          : 0,
      },
      recentActivities: activities.slice(0, 12).map((item) => ({
        id: item.id,
        action: item.action,
        targetType: item.target_type,
        targetId: item.target_id,
        createdAt: item.created_at,
      })),
    };
  }

  async transferOwnership(
    groupId: string,
    oldOwnerId: string,
    newOwnerMembershipId: string,
    newOwnerId: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.group_members.updateMany({
        where: { group_id: groupId, user_id: oldOwnerId, role: group_role.owner },
        data: { role: group_role.deputy },
      });
      await tx.group_members.update({
        where: { id: newOwnerMembershipId },
        data: { role: group_role.owner },
      });
      await tx.study_groups.update({ where: { id: groupId }, data: { owner_id: newOwnerId } });
    });
  }
  async setRolePermissions(
    groupId: string,
    role: ConfigurableWorkspaceRole,
    permissions: { permission: WorkspacePermission; allowed: boolean }[],
  ) {
    await this.prisma.$transaction(
      permissions.map(({ permission, allowed }) =>
        this.prisma.group_role_permissions.upsert({
          where: {
            group_id_role_permission: {
              group_id: groupId,
              role: role as group_role,
              permission: permission as group_permission,
            },
          },
          create: {
            group_id: groupId,
            role: role as group_role,
            permission: permission as group_permission,
            allowed,
          },
          update: { allowed },
        }),
      ),
    );
  }
  async setMemberPermissions(
    memberId: string,
    permissions: { permission: WorkspacePermission; allowed: boolean | null }[],
  ) {
    await this.prisma.$transaction(
      permissions.map(({ permission, allowed }) =>
        allowed === null
          ? this.prisma.group_member_permissions.deleteMany({
              where: { group_member_id: memberId, permission: permission as group_permission },
            })
          : this.prisma.group_member_permissions.upsert({
              where: {
                group_member_id_permission: {
                  group_member_id: memberId,
                  permission: permission as group_permission,
                },
              },
              create: {
                group_member_id: memberId,
                permission: permission as group_permission,
                allowed,
              },
              update: { allowed },
            }),
      ),
    );
  }
  async findUserByHandle(handle: string) {
    const user = await this.prisma.users.findUnique({
      where: { handle },
      select: { id: true, display_name: true, avatar_url: true, handle: true, email: true },
    });
    return user ? this.toUser(user) : null;
  }

  async findUserExternalId(userId: string) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { external_id: true },
    });
    return user?.external_id ?? null;
  }

  async refreshMemberCount(groupId: string) {
    const memberCount = await this.prisma.group_members.count({
      where: { group_id: groupId, status: member_status.active },
    });
    await this.prisma.study_groups.update({
      where: { id: groupId },
      data: { member_count: memberCount, updated_at: new Date() },
    });
    return memberCount;
  }

  async recordActivity(
    groupId: string,
    actorId: string,
    action: string,
    targetType?: string,
    targetId?: string,
  ) {
    const occurredAt = new Date();
    await this.prisma.$transaction([
      this.prisma.group_activities.create({
        data: {
          group_id: groupId,
          actor_id: actorId,
          action,
          target_type: targetType ?? null,
          target_id: targetId ?? null,
          created_at: occurredAt,
        },
      }),
      this.prisma.study_groups.update({
        where: { id: groupId },
        data: { last_activity_at: occurredAt },
      }),
    ]);
  }

  async upsertJoinRequest(groupId: string, userId: string, message?: string) {
    const row = await this.prisma.workspace_join_requests.upsert({
      where: { group_id_user_id: { group_id: groupId, user_id: userId } },
      create: { group_id: groupId, user_id: userId, message: message?.trim() || null },
      update: {
        status: join_request_status.pending,
        message: message?.trim() || null,
        reviewed_by: null,
        reviewed_at: null,
        updated_at: new Date(),
      },
      include: {
        requester: {
          select: { id: true, display_name: true, avatar_url: true, handle: true, email: true },
        },
      },
    });
    return this.toJoinRequest(row);
  }
  async listJoinRequests(groupId: string, status?: 'pending' | 'rejected') {
    const rows = await this.prisma.workspace_join_requests.findMany({
      where: {
        group_id: groupId,
        status: status ? (status as join_request_status) : undefined,
      },
      orderBy: { updated_at: 'desc' },
      include: {
        requester: {
          select: { id: true, display_name: true, avatar_url: true, handle: true, email: true },
        },
      },
    });
    return rows.map((row) => this.toJoinRequest(row));
  }
  async findJoinRequest(groupId: string, requestId: string) {
    const row = await this.prisma.workspace_join_requests.findFirst({
      where: { id: requestId, group_id: groupId },
      include: {
        requester: {
          select: { id: true, display_name: true, avatar_url: true, handle: true, email: true },
        },
      },
    });
    return row ? this.toJoinRequest(row) : null;
  }
  async findJoinRequestForUser(groupId: string, userId: string) {
    const row = await this.prisma.workspace_join_requests.findUnique({
      where: { group_id_user_id: { group_id: groupId, user_id: userId } },
      include: {
        requester: {
          select: { id: true, display_name: true, avatar_url: true, handle: true, email: true },
        },
      },
    });
    return row ? this.toJoinRequest(row) : null;
  }
  async reviewJoinRequest(requestId: string, reviewerId: string, status: 'approved' | 'rejected') {
    await this.prisma.workspace_join_requests.update({
      where: { id: requestId },
      data: {
        status: status as join_request_status,
        reviewed_by: reviewerId,
        reviewed_at: new Date(),
        updated_at: new Date(),
      },
    });
  }

  private toWorkspace(row: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    topic: string | null;
    status: group_status;
    owner_id: string;
    invite_code: string;
    member_count: number;
    avatar_url: string | null;
    avatar_key: string | null;
    cover_url: string | null;
    cover_key: string | null;
    cover_position: string;
    cover_fit: string;
    cover_height: string;
    privacy: workspace_privacy;
    join_policy: workspace_join_policy;
    created_at: Date;
    updated_at: Date;
    last_activity_at: Date | null;
  }): WorkspaceRecord {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      topic: row.topic,
      status: row.status,
      ownerId: row.owner_id,
      inviteCode: row.invite_code,
      memberCount: row.member_count,
      avatarUrl: row.avatar_url,
      avatarKey: row.avatar_key,
      coverUrl: row.cover_url,
      coverKey: row.cover_key,
      coverPosition: row.cover_position as WorkspaceRecord['coverPosition'],
      coverFit: row.cover_fit as WorkspaceRecord['coverFit'],
      coverHeight: row.cover_height as WorkspaceRecord['coverHeight'],
      privacy: row.privacy,
      joinPolicy: row.join_policy,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastActivityAt: row.last_activity_at,
    };
  }
  private toMembership(row: {
    id: string;
    group_id: string;
    user_id: string;
    role: group_role;
    status: member_status;
    joined_at: Date;
  }): MembershipRecord {
    return {
      id: row.id,
      groupId: row.group_id,
      userId: row.user_id,
      role: row.role,
      status: row.status,
      joinedAt: row.joined_at,
    };
  }
  private toUser(row: {
    id: string;
    display_name: string;
    avatar_url: string | null;
    handle?: string | null;
    email?: string;
  }): WorkspaceUser {
    return {
      id: row.id,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      handle: row.handle ?? undefined,
      email: row.email,
    };
  }
  private toJoinRequest(row: {
    id: string;
    group_id: string;
    user_id: string;
    status: join_request_status;
    message: string | null;
    created_at: Date;
    reviewed_at: Date | null;
    requester: {
      id: string;
      display_name: string;
      avatar_url: string | null;
      handle: string | null;
      email: string;
    };
  }) {
    return {
      id: row.id,
      groupId: row.group_id,
      userId: row.user_id,
      status: row.status,
      message: row.message,
      createdAt: row.created_at,
      reviewedAt: row.reviewed_at,
      user: this.toUser(row.requester),
    };
  }
}

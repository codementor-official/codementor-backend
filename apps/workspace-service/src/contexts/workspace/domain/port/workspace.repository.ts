import type {
  ConfigurableWorkspaceRole,
  MemberPermissionOverride,
  PermissionGrant,
  WorkspacePermission,
  WorkspaceRole,
} from '../model/workspace-policy';

export interface WorkspaceUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  handle?: string;
  email?: string;
}
export interface WorkspaceRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  topic: string | null;
  status: 'active' | 'archived';
  ownerId: string;
  inviteCode: string;
  memberCount: number;
  avatarUrl: string | null;
  avatarKey: string | null;
  coverUrl: string | null;
  coverKey: string | null;
  privacy: 'public' | 'private';
  joinPolicy: 'open' | 'approval' | 'invite_only';
  createdAt: Date;
  updatedAt: Date;
  lastActivityAt: Date | null;
}
export interface MembershipRecord {
  id: string;
  groupId: string;
  userId: string;
  role: WorkspaceRole;
  status: 'invited' | 'active' | 'removed';
  joinedAt: Date;
}
export interface WorkspaceDetailRecord extends WorkspaceRecord {
  owner: WorkspaceUser;
  membership: MembershipRecord | null;
  rolePermissions: PermissionGrant[];
  memberOverrides: MemberPermissionOverride[];
}
export interface WorkspaceListRecord extends WorkspaceRecord {
  owner: WorkspaceUser;
  role: WorkspaceRole;
  memberPreview: WorkspaceUser[];
  openTaskCount: number;
  progressPercent: number;
}
export interface WorkspaceMemberRecord extends MembershipRecord {
  user: WorkspaceUser;
}
export interface WorkspaceMemberDashboardRecord extends WorkspaceMemberRecord {
  xp: number;
  solvedCount: number;
  currentStreakDays: number;
  longestStreakDays: number;
  activeDays: number;
  lastActiveAt: Date | null;
  activityHeatmap: { date: string; count: number }[];
  rolePermissions: PermissionGrant[];
  memberOverrides: MemberPermissionOverride[];
  assignmentStats: { assigned: number; completed: number; inProgress: number; notStarted: number };
  submissionStats: { total: number; accepted: number; failed: number; averageScore: number };
  recentActivities: {
    id: string;
    action: string;
    targetType: string | null;
    targetId: string | null;
    createdAt: Date;
  }[];
}
export interface WorkspaceJoinRequestRecord {
  id: string;
  groupId: string;
  userId: string;
  status: 'pending' | 'approved' | 'rejected';
  message: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
  user: WorkspaceUser;
}
export interface WorkspaceCursor {
  updatedAt: Date;
  id: string;
}
export interface WorkspaceListFilter {
  scope?: 'all' | 'owned' | 'joined';
  q?: string;
  topic?: string;
  cursor?: WorkspaceCursor;
  limit: number;
}
export interface MemberListFilter {
  q?: string;
  role?: WorkspaceRole;
  page: number;
  limit: number;
  status?: 'active' | 'invited';
  progress?: 'not_started' | 'in_progress' | 'completed';
  activityLevel?: 'low' | 'medium' | 'high';
  submissionStatus?: 'not_submitted' | 'submitted' | 'passed';
  joinedFrom?: Date;
  joinedTo?: Date;
}

export interface WorkspaceRepository {
  listForUser(userId: string, filter: WorkspaceListFilter): Promise<WorkspaceListRecord[]>;
  summaryForUser(userId: string): Promise<{ total: number; owned: number; joined: number }>;
  findDetail(slug: string, userId: string): Promise<WorkspaceDetailRecord | null>;
  findActiveBySlug(slug: string): Promise<WorkspaceRecord | null>;
  findActiveByInviteCode(inviteCode: string): Promise<WorkspaceRecord | null>;
  create(input: {
    slug: string;
    inviteCode: string;
    name: string;
    description: string | null | undefined;
    topic: string | null | undefined;
    ownerId: string;
  }): Promise<WorkspaceRecord>;
  update(
    id: string,
    input: {
      name?: string;
      description?: string | null;
      topic?: string | null;
      status?: 'archived';
      inviteCode?: string;
      avatarUrl?: string | null;
      avatarKey?: string | null;
      coverUrl?: string | null;
      coverKey?: string | null;
      privacy?: 'public' | 'private';
      joinPolicy?: 'open' | 'approval' | 'invite_only';
    },
  ): Promise<void>;
  findMembership(
    groupId: string,
    userId: string,
    status?: 'active' | 'invited',
  ): Promise<MembershipRecord | null>;
  findMembershipAny(groupId: string, userId: string): Promise<MembershipRecord | null>;
  findMember(
    groupId: string,
    memberId: string,
    status?: 'active' | 'invited',
  ): Promise<MembershipRecord | null>;
  findMembershipWithPermissions(
    groupId: string,
    userId: string,
  ): Promise<
    | (MembershipRecord & {
        rolePermissions: PermissionGrant[];
        memberOverrides: MemberPermissionOverride[];
      })
    | null
  >;
  createMember(
    groupId: string,
    userId: string,
    role?: WorkspaceRole,
    status?: 'invited' | 'active',
  ): Promise<MembershipRecord>;
  updateMember(
    id: string,
    input: Partial<Pick<MembershipRecord, 'role' | 'status' | 'joinedAt'>>,
  ): Promise<void>;
  listMembers(
    groupId: string,
    filter: MemberListFilter,
  ): Promise<{ items: WorkspaceMemberRecord[]; total: number }>;
  memberDashboard(
    groupId: string,
    memberId: string,
  ): Promise<WorkspaceMemberDashboardRecord | null>;
  transferOwnership(
    groupId: string,
    oldOwnerId: string,
    newOwnerMembershipId: string,
    newOwnerId: string,
  ): Promise<void>;
  setRolePermissions(
    groupId: string,
    role: ConfigurableWorkspaceRole,
    permissions: { permission: WorkspacePermission; allowed: boolean }[],
  ): Promise<void>;
  setMemberPermissions(
    memberId: string,
    permissions: { permission: WorkspacePermission; allowed: boolean | null }[],
  ): Promise<void>;
  findUserByHandle(handle: string): Promise<WorkspaceUser | null>;
  refreshMemberCount(groupId: string): Promise<number>;
  recordActivity(
    groupId: string,
    actorId: string,
    action: string,
    targetType?: string,
    targetId?: string,
  ): Promise<void>;
  upsertJoinRequest(
    groupId: string,
    userId: string,
    message?: string,
  ): Promise<WorkspaceJoinRequestRecord>;
  listJoinRequests(groupId: string): Promise<WorkspaceJoinRequestRecord[]>;
  findJoinRequest(groupId: string, requestId: string): Promise<WorkspaceJoinRequestRecord | null>;
  reviewJoinRequest(
    requestId: string,
    reviewerId: string,
    status: 'approved' | 'rejected',
  ): Promise<void>;
}

export const WORKSPACE_REPOSITORY = Symbol('WORKSPACE_REPOSITORY');

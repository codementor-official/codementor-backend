import type { ConfigurableWorkspaceRole, MemberPermissionOverride, PermissionGrant, WorkspacePermission, WorkspaceRole } from '../model/workspace-policy';

export interface WorkspaceUser { id: string; displayName: string; avatarUrl: string | null; handle?: string }
export interface WorkspaceRecord {
  id: string; slug: string; name: string; description: string | null; topic: string | null;
  status: 'active' | 'archived'; ownerId: string; inviteCode: string; memberCount: number;
  createdAt: Date; updatedAt: Date; lastActivityAt: Date | null;
}
export interface MembershipRecord { id: string; groupId: string; userId: string; role: WorkspaceRole; status: 'invited' | 'active' | 'removed'; joinedAt: Date }
export interface WorkspaceDetailRecord extends WorkspaceRecord {
  owner: WorkspaceUser; membership: MembershipRecord | null; rolePermissions: PermissionGrant[]; memberOverrides: MemberPermissionOverride[];
}
export interface WorkspaceListRecord extends WorkspaceRecord { owner: WorkspaceUser; role: WorkspaceRole; memberPreview: WorkspaceUser[]; openTaskCount: number; progressPercent: number }
export interface WorkspaceMemberRecord extends MembershipRecord { user: WorkspaceUser }
export interface WorkspaceCursor { updatedAt: Date; id: string }
export interface WorkspaceListFilter { scope?: 'all' | 'owned' | 'joined'; q?: string; topic?: string; cursor?: WorkspaceCursor; limit: number }
export interface MemberListFilter { q?: string; role?: WorkspaceRole; cursor?: WorkspaceCursor; limit: number; status?: 'active' | 'invited' }

export interface WorkspaceRepository {
  listForUser(userId: string, filter: WorkspaceListFilter): Promise<WorkspaceListRecord[]>;
  summaryForUser(userId: string): Promise<{ total: number; owned: number; joined: number }>;
  findDetail(slug: string, userId: string): Promise<WorkspaceDetailRecord | null>;
  findActiveBySlug(slug: string): Promise<WorkspaceRecord | null>;
  findActiveByInviteCode(inviteCode: string): Promise<WorkspaceRecord | null>;
  create(input: { slug: string; inviteCode: string; name: string; description: string | null | undefined; topic: string | null | undefined; ownerId: string }): Promise<WorkspaceRecord>;
  update(id: string, input: { name?: string; description?: string | null; topic?: string | null; status?: 'archived'; inviteCode?: string }): Promise<void>;
  findMembership(groupId: string, userId: string, status?: 'active' | 'invited'): Promise<MembershipRecord | null>;
  findMembershipAny(groupId: string, userId: string): Promise<MembershipRecord | null>;
  findMember(groupId: string, memberId: string, status?: 'active' | 'invited'): Promise<MembershipRecord | null>;
  findMembershipWithPermissions(groupId: string, userId: string): Promise<(MembershipRecord & { rolePermissions: PermissionGrant[]; memberOverrides: MemberPermissionOverride[] }) | null>;
  createMember(groupId: string, userId: string, role?: WorkspaceRole, status?: 'invited' | 'active'): Promise<MembershipRecord>;
  updateMember(id: string, input: Partial<Pick<MembershipRecord, 'role' | 'status' | 'joinedAt'>>): Promise<void>;
  listMembers(groupId: string, filter: MemberListFilter): Promise<WorkspaceMemberRecord[]>;
  transferOwnership(groupId: string, oldOwnerId: string, newOwnerMembershipId: string, newOwnerId: string): Promise<void>;
  setRolePermissions(groupId: string, role: ConfigurableWorkspaceRole, permissions: { permission: WorkspacePermission; allowed: boolean }[]): Promise<void>;
  setMemberPermissions(memberId: string, permissions: { permission: WorkspacePermission; allowed: boolean }[]): Promise<void>;
  findUserByHandle(handle: string): Promise<WorkspaceUser | null>;
}

export const WORKSPACE_REPOSITORY = Symbol('WORKSPACE_REPOSITORY');

import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { AlreadyExists, BusinessRuleViolation, NotAuthorized, NotFound } from '@codementor/kernel';
import { assertCanManageWorkspace, assertConfigurableRole, normalisePermissionPatch, resolveWorkspacePermissions, rolePermissionsFor } from '../domain/model/workspace-policy';
import { WORKSPACE_REPOSITORY, type WorkspaceCursor, type WorkspaceRepository } from '../domain/port/workspace.repository';
import type { CreateWorkspaceDto, JoinWorkspaceDto, ListMembersQueryDto, ListWorkspacesQueryDto, TransferOwnershipDto, UpdateMemberPermissionsDto, UpdateMemberRoleDto, UpdateRolePermissionsDto, UpdateWorkspaceDto } from '../presentation/dto/workspace.dto';

const DEFAULT_LIMIT = 12;

/** Application layer: điều phối use case; policy nằm ở domain, I/O nằm ở repository port. */
@Injectable()
export class WorkspaceService {
  constructor(@Inject(WORKSPACE_REPOSITORY) private readonly workspaces: WorkspaceRepository) {}

  async list(userId: string, query: ListWorkspacesQueryDto) {
    const limit = clamp(query.limit, DEFAULT_LIMIT, 50);
    const rows = await this.workspaces.listForUser(userId, { scope: query.scope, q: query.q?.trim() || undefined, topic: query.topic?.trim() || undefined, cursor: query.cursor ? decodeCursor(query.cursor) : undefined, limit });
    const page = rows.slice(0, limit); const last = page.at(-1);
    return { items: page.map((row) => ({ id: row.id, slug: row.slug, name: row.name, description: row.description, topic: row.topic, memberCount: row.memberCount, lastActivityAt: row.lastActivityAt ?? row.updatedAt, owner: row.owner, memberPreview: row.memberPreview, role: row.role, openTaskCount: row.openTaskCount, progressPercent: row.progressPercent })), nextCursor: rows.length > limit && last ? encodeCursor(last.updatedAt, last.id) : null };
  }

  summary(userId: string) { return this.workspaces.summaryForUser(userId); }

  async detail(userId: string, slug: string) {
    const data = await this.workspaces.findDetail(slug, userId);
    if (!data?.membership) throw new NotFound('Không tìm thấy nhóm học tập');
    const permissions = resolveWorkspacePermissions(data.membership.role, data.rolePermissions, data.memberOverrides);
    return { id: data.id, slug: data.slug, name: data.name, description: data.description, topic: data.topic, status: data.status, memberCount: data.memberCount, createdAt: data.createdAt, updatedAt: data.updatedAt, lastActivityAt: data.lastActivityAt, owner: data.owner, currentMembership: { id: data.membership.id, role: data.membership.role, joinedAt: data.membership.joinedAt, permissions }, inviteCode: data.membership.role === 'owner' ? data.inviteCode : null, rolePermissions: data.membership.role === 'owner' ? { deputy: rolePermissionsFor('deputy', data.rolePermissions), member: rolePermissionsFor('member', data.rolePermissions) } : null };
  }

  async create(userId: string, dto: CreateWorkspaceDto) {
    const name = dto.name.trim(); if (!name) throw new BusinessRuleViolation('Tên nhóm không được để trống');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try { const created = await this.workspaces.create({ slug: `${slugify(name)}-${randomSuffix(5)}`, inviteCode: randomInviteCode(), name, description: trimOptional(dto.description), topic: trimOptional(dto.topic), ownerId: userId }); return this.detail(userId, created.slug); }
      catch (error) { if (attempt === 4 || !isUniqueViolation(error)) throw error; }
    }
    throw new AlreadyExists('Nhóm học tập');
  }

  async update(userId: string, slug: string, dto: UpdateWorkspaceDto) {
    const workspace = await this.requireOwner(userId, slug); const name = dto.name === undefined ? undefined : dto.name.trim();
    if (name === '') throw new BusinessRuleViolation('Tên nhóm không được để trống');
    await this.workspaces.update(workspace.id, { name, description: dto.description === undefined ? undefined : trimOptional(dto.description), topic: dto.topic === undefined ? undefined : trimOptional(dto.topic) }); return this.detail(userId, slug);
  }
  async archive(userId: string, slug: string) { const workspace = await this.requireOwner(userId, slug); await this.workspaces.update(workspace.id, { status: 'archived' }); return { archived: true }; }
  async rotateInviteCode(userId: string, slug: string) { const workspace = await this.requireOwner(userId, slug); for (let attempt = 0; attempt < 5; attempt += 1) { try { const inviteCode = randomInviteCode(); await this.workspaces.update(workspace.id, { inviteCode }); return { inviteCode }; } catch (error) { if (attempt === 4 || !isUniqueViolation(error)) throw error; } } throw new AlreadyExists('Mã mời'); }

  async join(userId: string, dto: JoinWorkspaceDto) {
    const workspace = await this.workspaces.findActiveByInviteCode(dto.inviteCode.trim()); if (!workspace) throw new NotFound('Không tìm thấy nhóm học tập bằng mã mời này');
    const existing = await this.workspaces.findMembershipAny(workspace.id, userId);
    if (existing?.status === 'active') return this.detail(userId, workspace.slug);
    if (existing) await this.workspaces.updateMember(existing.id, { status: 'active', role: 'member', joinedAt: new Date() }); else await this.workspaces.createMember(workspace.id, userId);
    return this.detail(userId, workspace.slug);
  }
  async leave(userId: string, slug: string) { const workspace = await this.requireActive(slug); const member = await this.workspaces.findMembership(workspace.id, userId); if (!member) throw new NotFound('Bạn không còn là thành viên của nhóm này'); if (member.role === 'owner') throw new BusinessRuleViolation('Chủ nhóm cần chuyển quyền sở hữu trước khi rời nhóm'); await this.workspaces.updateMember(member.id, { status: 'removed' }); return { left: true }; }

  async members(userId: string, slug: string, query: ListMembersQueryDto) {
    const workspace = await this.requireActive(slug); const requester = await this.workspaces.findMembership(workspace.id, userId); if (!requester) throw new NotFound('Không tìm thấy nhóm học tập');
    const limit = clamp(query.limit, 20, 100); const rows = await this.workspaces.listMembers(workspace.id, { q: query.q?.trim() || undefined, role: query.role, cursor: query.cursor ? decodeCursor(query.cursor) : undefined, limit }); const page = rows.slice(0, limit); const last = page.at(-1);
    return { items: page.map((member) => ({ id: member.id, user: member.user, role: member.role, joinedAt: member.joinedAt })), nextCursor: rows.length > limit && last ? encodeCursor(last.joinedAt, last.id) : null, canManage: requester.role === 'owner' };
  }
  async updateMemberRole(userId: string, slug: string, memberId: string, dto: UpdateMemberRoleDto) { const workspace = await this.requireOwner(userId, slug); const member = await this.workspaces.findMember(workspace.id, memberId); if (!member) throw new NotFound('Không tìm thấy thành viên'); if (member.role === 'owner') throw new BusinessRuleViolation('Không thể đổi role của Chủ nhóm'); await this.workspaces.updateMember(member.id, { role: dto.role }); return { updated: true }; }
  async removeMember(userId: string, slug: string, memberId: string) { const workspace = await this.requireActive(slug); const requester = await this.workspaces.findMembershipWithPermissions(workspace.id, userId); const target = await this.workspaces.findMember(workspace.id, memberId); if (!requester || !target) throw new NotFound('Không tìm thấy thành viên'); if (target.role === 'owner') throw new BusinessRuleViolation('Không thể xoá Chủ nhóm'); const permissions = resolveWorkspacePermissions(requester.role, requester.rolePermissions, requester.memberOverrides); if (requester.role !== 'owner' && !permissions.remove_member) throw new NotAuthorized('Bạn không có quyền xoá thành viên'); if (requester.role !== 'owner' && target.role !== 'member') throw new NotAuthorized('Chỉ Chủ nhóm mới có thể xoá Phó nhóm'); await this.workspaces.updateMember(target.id, { status: 'removed' }); return { removed: true }; }
  async transferOwnership(userId: string, slug: string, dto: TransferOwnershipDto) { const workspace = await this.requireOwner(userId, slug); const target = await this.workspaces.findMember(workspace.id, dto.memberId); if (!target) throw new NotFound('Người nhận quyền phải là thành viên đang hoạt động'); if (target.userId === userId) throw new BusinessRuleViolation('Bạn đang là Chủ nhóm'); await this.workspaces.transferOwnership(workspace.id, userId, target.id, target.userId); return { transferred: true }; }
  async updateRolePermissions(userId: string, slug: string, role: string, dto: UpdateRolePermissionsDto) { assertConfigurableRole(role); const workspace = await this.requireOwner(userId, slug); await this.workspaces.setRolePermissions(workspace.id, role, normalisePermissionPatch(dto.permissions)); return this.detail(userId, slug); }
  async updateMemberPermissions(userId: string, slug: string, memberId: string, dto: UpdateMemberPermissionsDto) { const workspace = await this.requireOwner(userId, slug); const member = await this.workspaces.findMember(workspace.id, memberId); if (!member) throw new NotFound('Không tìm thấy thành viên'); await this.workspaces.setMemberPermissions(member.id, normalisePermissionPatch(dto.permissions)); return { updated: true }; }

  async invite(userId: string, slug: string, handle: string) { const workspace = await this.requireOwner(userId, slug); const user = await this.workspaces.findUserByHandle(handle.trim()); if (!user) throw new NotFound('Không tìm thấy người dùng'); if (user.id === userId) throw new BusinessRuleViolation('Bạn đã là Chủ nhóm'); const existing = await this.workspaces.findMembershipAny(workspace.id, user.id); if (existing?.status === 'active') throw new AlreadyExists('Thành viên'); if (existing) { await this.workspaces.updateMember(existing.id, { status: 'invited', role: 'member' }); return { invitationId: existing.id, user }; } const invitation = await this.workspaces.createMember(workspace.id, user.id, 'member', 'invited'); return { invitationId: invitation.id, user }; }
  async invitations(userId: string, slug: string, query: ListMembersQueryDto) { const workspace = await this.requireOwner(userId, slug); const limit = clamp(query.limit, 20, 100); const rows = await this.workspaces.listMembers(workspace.id, { q: query.q?.trim() || undefined, cursor: query.cursor ? decodeCursor(query.cursor) : undefined, limit, status: 'invited' }); const page = rows.slice(0, limit); const last = page.at(-1); return { items: page.map((member) => ({ id: member.id, user: member.user, role: member.role, invitedAt: member.joinedAt })), nextCursor: rows.length > limit && last ? encodeCursor(last.joinedAt, last.id) : null }; }
  async acceptInvitation(userId: string, slug: string, invitationId: string) { const workspace = await this.requireActive(slug); const invitation = await this.workspaces.findMember(workspace.id, invitationId, 'invited'); if (!invitation || invitation.userId !== userId) throw new NotFound('Không tìm thấy lời mời'); await this.workspaces.updateMember(invitation.id, { status: 'active', joinedAt: new Date() }); return this.detail(userId, slug); }
  async revokeInvitation(userId: string, slug: string, invitationId: string) { const workspace = await this.requireOwner(userId, slug); const invitation = await this.workspaces.findMember(workspace.id, invitationId, 'invited'); if (!invitation) throw new NotFound('Không tìm thấy lời mời'); await this.workspaces.updateMember(invitation.id, { status: 'removed' }); return { revoked: true }; }

  private async requireActive(slug: string) { const workspace = await this.workspaces.findActiveBySlug(slug); if (!workspace) throw new NotFound('Không tìm thấy nhóm học tập'); return workspace; }
  private async requireOwner(userId: string, slug: string) { const workspace = await this.requireActive(slug); assertCanManageWorkspace(workspace.ownerId === userId ? 'owner' : 'member'); return workspace; }
}
function clamp(value: number | undefined, fallback: number, max: number) { return Math.min(Math.max(value ?? fallback, 1), max); }
function trimOptional(value: string | null | undefined): string | null | undefined { if (value === undefined) return undefined; if (value === null) return null; return value.trim() || null; }
function slugify(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56) || 'nhom-hoc-tap'; }
function randomSuffix(length: number) { return randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length); }
function randomInviteCode() { return randomBytes(5).toString('hex').toUpperCase(); }
function encodeCursor(updatedAt: Date, id: string) { return Buffer.from(`${updatedAt.toISOString()}|${id}`).toString('base64url'); }
function decodeCursor(cursor: string): WorkspaceCursor | undefined { try { const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|'); const updatedAt = new Date(iso ?? ''); return id && !Number.isNaN(updatedAt.getTime()) ? { updatedAt, id } : undefined; } catch { return undefined; } }
function isUniqueViolation(error: unknown) { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'; }

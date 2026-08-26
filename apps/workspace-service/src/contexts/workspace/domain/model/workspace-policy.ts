import { BusinessRuleViolation, NotAuthorized } from '@codementor/kernel';

export const WORKSPACE_PERMISSIONS = [
  'view_doc',
  'upload_doc',
  'edit_own_doc',
  'delete_own_doc',
  'edit_doc',
  'approve_doc',
  'view_exercise',
  'create_exercise',
  'edit_own_exercise',
  'delete_own_exercise',
  'delete_exercise',
  'assign_exercise',
  'edit_exercise',
  'delete_doc',
  'review_submission',
  'remove_member',
] as const;
export type WorkspacePermission = (typeof WORKSPACE_PERMISSIONS)[number];
export type WorkspaceRole = 'owner' | 'deputy' | 'member';
export type ConfigurableWorkspaceRole = Exclude<WorkspaceRole, 'owner'>;
export type EffectivePermissions = Record<WorkspacePermission, boolean>;
export type PermissionGrant = {
  role: WorkspaceRole;
  permission: WorkspacePermission;
  allowed: boolean;
};
export type MemberPermissionOverride = { permission: WorkspacePermission; allowed: boolean };

/** Default an toàn, tương ứng với dữ liệu seed: Deputy hỗ trợ vận hành, Member chỉ tải tài liệu. */
export const DEFAULT_ROLE_PERMISSIONS: Record<
  ConfigurableWorkspaceRole,
  Partial<EffectivePermissions>
> = {
  deputy: {
    view_doc: true,
    upload_doc: true,
    edit_own_doc: true,
    delete_own_doc: true,
    edit_doc: true,
    approve_doc: true,
    view_exercise: true,
    create_exercise: true,
    edit_own_exercise: true,
    delete_own_exercise: true,
    delete_exercise: true,
    assign_exercise: true,
    edit_exercise: true,
    review_submission: true,
    remove_member: true,
  },
  member: {
    view_doc: true,
    upload_doc: true,
    edit_own_doc: true,
    delete_own_doc: true,
    view_exercise: true,
  },
};

export function resolveWorkspacePermissions(
  role: WorkspaceRole,
  rolePermissions: PermissionGrant[],
  overrides: MemberPermissionOverride[],
): EffectivePermissions {
  const defaults = role === 'owner' ? {} : DEFAULT_ROLE_PERMISSIONS[role];
  const result = Object.fromEntries(
    WORKSPACE_PERMISSIONS.map((permission) => [
      permission,
      role === 'owner' || defaults[permission] === true,
    ]),
  ) as EffectivePermissions;
  if (role === 'owner') return result;
  for (const grant of rolePermissions)
    if (grant.role === role) result[grant.permission] = grant.allowed;
  for (const override of overrides) result[override.permission] = override.allowed;
  return result;
}

export function rolePermissionsFor(
  role: ConfigurableWorkspaceRole,
  grants: PermissionGrant[],
): EffectivePermissions {
  return resolveWorkspacePermissions(role, grants, []);
}

export function assertConfigurableRole(role: string): asserts role is ConfigurableWorkspaceRole {
  if (role !== 'deputy' && role !== 'member') throw new BusinessRuleViolation('Role không hợp lệ');
}

export function assertCanManageWorkspace(role: WorkspaceRole): void {
  if (role !== 'owner') throw new NotAuthorized('Chỉ Chủ nhóm mới được thực hiện thao tác này');
}

export function normalisePermissionPatch(
  input: Record<string, boolean | null>,
): { permission: WorkspacePermission; allowed: boolean | null }[] {
  const unknown = Object.keys(input).find(
    (permission) => !WORKSPACE_PERMISSIONS.includes(permission as WorkspacePermission),
  );
  if (unknown) throw new BusinessRuleViolation(`Quyền không hợp lệ: ${unknown}`);
  const invalid = Object.entries(input).find(
    ([, allowed]) => allowed !== null && typeof allowed !== 'boolean',
  );
  if (invalid) throw new BusinessRuleViolation(`Giá trị quyền không hợp lệ: ${invalid[0]}`);
  return Object.entries(input).map(([permission, allowed]) => ({
    permission: permission as WorkspacePermission,
    allowed,
  }));
}

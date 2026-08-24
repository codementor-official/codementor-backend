import { resolveWorkspacePermissions } from './workspace-policy';

describe('Workspace permission policy', () => {
  it('Owner luôn có mọi quyền, không thể bị override bởi dữ liệu lưu trữ', () => {
    const permissions = resolveWorkspacePermissions('owner', [], [{ permission: 'remove_member', allowed: false }]);
    expect(Object.values(permissions).every(Boolean)).toBe(true);
  });

  it('override của từng thành viên có độ ưu tiên cao hơn role mặc định', () => {
    const permissions = resolveWorkspacePermissions(
      'deputy',
      [{ role: 'deputy', permission: 'remove_member', allowed: true }],
      [{ permission: 'remove_member', allowed: false }],
    );
    expect(permissions.remove_member).toBe(false);
  });

  it('Member chỉ có quyền nội dung của chính mình theo mặc định', () => {
    const permissions = resolveWorkspacePermissions('member', [], []);
    expect(permissions.view_doc).toBe(true);
    expect(permissions.upload_doc).toBe(true);
    expect(permissions.edit_own_doc).toBe(true);
    expect(permissions.manage_doc).toBe(false);
    expect(permissions.view_exercise).toBe(true);
    expect(permissions.manage_exercise).toBe(false);
  });

  it('member override có thể thu hồi một quyền mặc định granular', () => {
    const permissions = resolveWorkspacePermissions(
      'member',
      [],
      [{ permission: 'delete_own_doc', allowed: false }],
    );
    expect(permissions.delete_own_doc).toBe(false);
  });
});

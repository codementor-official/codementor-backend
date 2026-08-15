import { platformRoleOf } from './jwt-payload';
import type { KeycloakToken } from './jwt-payload';

function token(roles?: string[]): KeycloakToken {
  return {
    sub: 'ffb9a3f0-0000-0000-0000-000000000001',
    iss: 'http://localhost:8080/realms/codementor',
    aud: 'codementor-api',
    exp: 0,
    iat: 0,
    ...(roles ? { realm_access: { roles } } : {}),
  };
}

describe('platformRoleOf', () => {
  it('mặc định learner khi token không có realm role nào', () => {
    expect(platformRoleOf(token())).toBe('learner');
    expect(platformRoleOf(token([]))).toBe('learner');
  });

  it('nhận diện từng vai trò', () => {
    expect(platformRoleOf(token(['learner']))).toBe('learner');
    expect(platformRoleOf(token(['lecturer']))).toBe('lecturer');
    expect(platformRoleOf(token(['admin']))).toBe('admin');
  });

  it('bỏ qua realm role không thuộc nền tảng', () => {
    expect(platformRoleOf(token(['offline_access', 'uma_authorization']))).toBe('learner');
  });

  // Keycloak cho phép gán nhiều realm role cùng lúc. Nếu lấy phần tử đầu tiên của
  // mảng thì quyền của một người sẽ đổi theo thứ tự Keycloak trả về, tức là ngẫu nhiên.
  it('lấy vai trò cao nhất khi có nhiều vai trò, không phụ thuộc thứ tự', () => {
    expect(platformRoleOf(token(['learner', 'admin']))).toBe('admin');
    expect(platformRoleOf(token(['admin', 'learner']))).toBe('admin');
    expect(platformRoleOf(token(['learner', 'lecturer']))).toBe('lecturer');
    expect(platformRoleOf(token(['lecturer', 'admin', 'learner']))).toBe('admin');
  });
});

import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AuthenticatedUser, PlatformRole } from './jwt-payload';
import { RolesGuard } from './roles.guard';

/**
 * Các kịch bản ở đây đến từ bộ test viết cho mô hình vai trò dạng mảng (`UserRole[]`), được
 * chuyển sang mô hình một-vai-trò khi hai nhánh gặp nhau. Kỳ vọng khác đi ở hai chỗ, và cả
 * hai đều là chủ ý: guard này NÉM 403 thay vì trả `false`, để người gọi biết thiếu vai trò
 * gì; và `admin` đi được mọi cửa mà không phải liệt kê ở từng endpoint.
 */
const user = (role: PlatformRole): AuthenticatedUser => ({
  id: role === 'ai_agent' ? null : 'a0000000-0000-4000-8000-000000000001',
  externalId: 'keycloak-subject',
  email: 'user@codementor.dev',
  displayName: 'User',
  role,
  actorType: role === 'ai_agent' ? 'service' : 'human',
});

function context(authenticatedUser?: AuthenticatedUser): ExecutionContext {
  return {
    getHandler: () => context,
    getClass: () => RolesGuard,
    switchToHttp: () => ({ getRequest: () => ({ user: authenticatedUser }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;
  const guard = new RolesGuard(reflector);

  beforeEach(() => jest.clearAllMocks());

  it('cho qua route không khai báo vai trò', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(context(user('learner')))).toBe(true);
  });

  it.each<PlatformRole>(['learner', 'lecturer'])('chặn %s ở endpoint dành cho admin', (role) => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    expect(() => guard.canActivate(context(user(role)))).toThrow(/admin/);
  });

  it('cho admin vào endpoint dành cho admin', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    expect(guard.canActivate(context(user('admin')))).toBe(true);
  });

  // Khác bộ test gốc: admin không phải được liệt kê ở từng endpoint mới vào được.
  it('admin đi được cả endpoint chỉ khai báo lecturer', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['lecturer']);
    expect(guard.canActivate(context(user('admin')))).toBe(true);
  });

  it('tài khoản dịch vụ chỉ vào được endpoint khai báo đúng nó', () => {
    const aiAgent = user('ai_agent');
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ai_agent']);
    expect(guard.canActivate(context(aiAgent))).toBe(true);

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    expect(() => guard.canActivate(context(aiAgent))).toThrow();
  });

  // Không có request.user nghĩa là KeycloakAuthGuard chưa chạy hoặc đã bị bỏ qua. Fail
  // closed: thà chặn nhầm còn hơn mở một endpoint có khai báo vai trò.
  it('chặn khi request chưa có user', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['lecturer']);
    expect(guard.canActivate(context(undefined))).toBe(false);
  });
});

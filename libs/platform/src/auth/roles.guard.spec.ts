import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from './jwt-payload';
import { RolesGuard } from './roles.guard';
import { UserRole } from './user-role';

const user = (roles: UserRole[]): AuthenticatedUser => ({
  id: 'a0000000-0000-4000-8000-000000000001',
  externalId: 'keycloak-subject',
  email: 'user@codementor.dev',
  displayName: 'User',
  roles,
  actorType: 'human',
  platformRole: 'learner',
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

  it('allows authenticated routes without role metadata', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(context(user([UserRole.STUDENT])))).toBe(true);
  });

  it.each([UserRole.STUDENT, UserRole.LECTURER])(
    'rejects %s from an ADMIN endpoint',
    (role) => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.ADMIN]);
      expect(guard.canActivate(context(user([role])))).toBe(false);
    },
  );

  it('allows ADMIN on an ADMIN endpoint', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.ADMIN]);
    expect(guard.canActivate(context(user([UserRole.ADMIN])))).toBe(true);
  });

  it('allows AI_AGENT only on explicitly assigned endpoints', () => {
    const aiAgent = user([UserRole.AI_AGENT]);
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.AI_AGENT]);
    expect(guard.canActivate(context(aiAgent))).toBe(true);

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.ADMIN]);
    expect(guard.canActivate(context(aiAgent))).toBe(false);
  });
});

import { QuotaExceeded } from '@codementor/kernel';
import type { OwnerEntitlements, OwnerUsage } from '../domain/model/workspace-quota';
import { WorkspaceService } from './workspace.service';

jest.mock('@codementor/messaging', () => ({ EVENT_BUS: Symbol('EVENT_BUS') }));

const free: OwnerEntitlements = {
  source: 'free',
  planName: 'Free',
  maxOwnedGroups: 1,
  maxMembersPerGroup: 10,
  maxStorageBytes: 100 * 1024 ** 2,
  maxUploadBytes: 10 * 1024 ** 2,
};
const ownerId = '10000000-0000-4000-8000-000000000001';
const userId = '10000000-0000-4000-8000-000000000002';
const group = { id: '20000000-0000-4000-8000-000000000001', slug: 'g', ownerId, memberCount: 10, joinPolicy: 'invite_only', privacy: 'private' };

/** The repositories run each guard the way the Prisma adapters do: under lock, before writing. */
function setup(usage: OwnerUsage, activeMembers = 10) {
  const workspaces = {
    create: jest.fn(async (_input: unknown, guard: (s: unknown) => void) => {
      guard({ entitlements: free, usage });
      return { slug: 'created' };
    }),
    findActiveByInviteCode: jest.fn().mockResolvedValue(group),
    findActiveBySlug: jest.fn().mockResolvedValue(group),
    findMembershipAny: jest.fn().mockResolvedValue(null),
    findMember: jest.fn().mockResolvedValue({ id: 'm2', userId }),
    findUserByHandle: jest.fn().mockResolvedValue({ id: userId }),
    recordActivity: jest.fn(),
    createMember: jest.fn(),
  };
  const quota = {
    snapshot: jest.fn().mockResolvedValue({ entitlements: free, usage }),
    admitMember: jest.fn(async (_g: string, _u: string, guard: (e: unknown, n: number) => void) => {
      guard(free, activeMembers);
      return 'membership';
    }),
    transferOwnership: jest.fn(async (input: { guard: (s: unknown, g: unknown) => void }) =>
      input.guard({ entitlements: free, usage }, { members: activeMembers, storedBytes: 0 }),
    ),
  };
  const service = new WorkspaceService(workspaces as never, quota as never, { publish: jest.fn() } as never);
  return { service, workspaces, quota };
}

describe('WorkspaceService plan limits', () => {
  it('refuses a second group on Free and never reaches the detail lookup', async () => {
    const { service } = setup({ ownedGroups: 1, storedBytes: 0, reservedBytes: 0 });
    await expect(service.create(ownerId, { name: 'Second' } as never)).rejects.toMatchObject({
      code: 'WORKSPACE_GROUP_LIMIT_REACHED',
      details: { limit: 1, used: 1 },
    });
  });

  it('refuses to join a full group through an invite code', async () => {
    const { service, workspaces } = setup({ ownedGroups: 1, storedBytes: 0, reservedBytes: 0 }, 10);
    await expect(service.join(userId, { inviteCode: 'ABCDE' })).rejects.toBeInstanceOf(QuotaExceeded);
    expect(workspaces.recordActivity).not.toHaveBeenCalled();
  });

  it('admits the member who takes the last seat and records it once', async () => {
    const { service, workspaces } = setup({ ownedGroups: 1, storedBytes: 0, reservedBytes: 0 }, 9);
    await expect(service.join(userId, { inviteCode: 'ABCDE' })).resolves.toEqual({ status: 'joined', workspaceSlug: 'g' });
    expect(workspaces.recordActivity).toHaveBeenCalledTimes(1);
  });

  it('refuses an invitation the group could not accept', async () => {
    const { service, workspaces } = setup({ ownedGroups: 1, storedBytes: 0, reservedBytes: 0 });
    await expect(service.invite(ownerId, 'g', 'friend')).rejects.toMatchObject({ code: 'WORKSPACE_MEMBER_LIMIT_REACHED' });
    expect(workspaces.createMember).not.toHaveBeenCalled();
  });

  it('blocks a transfer to an owner without room and explains every reason', async () => {
    const { service } = setup({ ownedGroups: 1, storedBytes: 0, reservedBytes: 0 }, 12);
    await expect(service.transferOwnership(ownerId, 'g', { memberId: 'm2' })).rejects.toMatchObject({
      code: 'WORKSPACE_GROUP_LIMIT_REACHED',
      details: { problems: [expect.anything(), expect.objectContaining({ code: 'WORKSPACE_MEMBER_LIMIT_REACHED' })] },
    });
  });
});

import { BusinessRuleViolation, NotAuthorized } from '@codementor/kernel';
import type { AuthenticatedUser } from '@codementor/platform';
import { AdminWorkspaceService } from './admin-workspace.service';

// Chỉ cần token DI; nạp thật thì kéo theo jwks-rsa (ESM) mà jest không đọc được.
jest.mock('@codementor/messaging', () => ({ EVENT_BUS: Symbol('EVENT_BUS') }));

describe('AdminWorkspaceService', () => {
  const workspaceId = '20000000-0000-4000-8000-000000000001';
  const memberId = '30000000-0000-4000-8000-000000000001';
  const admin = { id: 'admin-1', role: 'admin', actorType: 'human' } as AuthenticatedUser;
  const lecturer = { id: 'lect-1', role: 'lecturer', actorType: 'human' } as AuthenticatedUser;

  function setup(targetRole = 'member') {
    const repo = {
      findByIdWithOwner: jest.fn().mockResolvedValue({ id: workspaceId, status: 'active' }),
      update: jest.fn(),
      recordActivity: jest.fn(),
      findMember: jest.fn().mockResolvedValue({ id: memberId, userId: 'u-2', role: targetRole }),
      updateMember: jest.fn(),
      refreshMemberCount: jest.fn(),
      listAll: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    };
    const events = { publish: jest.fn() };
    return { repo, events, service: new AdminWorkspaceService(repo as never, events as never) };
  }

  it('rejects non-admins even past the HTTP guard', async () => {
    const { service, repo } = setup();
    await expect(service.list(lecturer, {})).rejects.toBeInstanceOf(NotAuthorized);
    await expect(service.setStatus(lecturer, workspaceId, 'archived')).rejects.toBeInstanceOf(NotAuthorized);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('archives and records who did it', async () => {
    const { service, repo } = setup();
    await service.setStatus(admin, workspaceId, 'archived');
    expect(repo.update).toHaveBeenCalledWith(workspaceId, { status: 'archived' });
    expect(repo.recordActivity).toHaveBeenCalledWith(workspaceId, 'admin-1', expect.any(String), 'workspace', workspaceId);
  });

  it('never removes the owner and requires a reason', async () => {
    await expect(setup('owner').service.removeMember(admin, workspaceId, memberId, 'spam')).rejects.toBeInstanceOf(BusinessRuleViolation);
    await expect(setup().service.removeMember(admin, workspaceId, memberId, '  ')).rejects.toBeInstanceOf(BusinessRuleViolation);
  });

  it('removes a member and refreshes the count', async () => {
    const { service, repo, events } = setup();
    await service.removeMember(admin, workspaceId, memberId, 'spam');
    expect(repo.updateMember).toHaveBeenCalledWith(memberId, { status: 'removed' });
    expect(repo.refreshMemberCount).toHaveBeenCalledWith(workspaceId);
    expect(events.publish).toHaveBeenCalled();
  });
});

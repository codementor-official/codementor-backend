import { NotAuthorized } from '@codementor/kernel';
import {
  WORKSPACE_PERMISSIONS,
  type EffectivePermissions,
  type WorkspacePermission,
} from '../domain/model/workspace-policy';
import { WorkspaceContentService } from './workspace-content.service';

jest.mock('@codementor/platform', () => ({
  DOCUMENT_CONTENT_TYPES: [],
  ObjectStorageService: class ObjectStorageService {},
}));

describe('WorkspaceContentService permission boundaries', () => {
  const userId = '10000000-0000-4000-8000-000000000001';
  const otherUserId = '10000000-0000-4000-8000-000000000002';
  const workspaceId = '20000000-0000-4000-8000-000000000001';
  const contentId = '30000000-0000-4000-8000-000000000001';

  function createService(granted: WorkspacePermission[]) {
    const permissions = Object.fromEntries(
      WORKSPACE_PERMISSIONS.map((permission) => [permission, granted.includes(permission)]),
    ) as EffectivePermissions;
    const workspaces = {
      detail: jest.fn().mockResolvedValue({
        id: workspaceId,
        currentMembership: { id: contentId, role: 'deputy', permissions },
      }),
    };
    const content = {
      findDocument: jest.fn().mockResolvedValue({
        id: contentId,
        uploaderId: otherUserId,
        deletedAt: null,
      }),
      updateDocument: jest.fn().mockResolvedValue({ id: contentId }),
      exerciseDetail: jest.fn().mockResolvedValue({
        id: contentId,
        authorId: otherUserId,
        publicationStatus: 'published',
        assignmentMemberIds: [],
      }),
      updateExercise: jest.fn().mockResolvedValue({ id: contentId }),
      assignmentNotificationRecipients: jest.fn().mockResolvedValue([]),
      softDeleteExercise: jest.fn().mockResolvedValue(true),
    };
    return {
      service: new WorkspaceContentService(
        workspaces as never,
        content as never,
        {} as never,
        {} as never,
        { publish: jest.fn() } as never,
      ),
      content,
    };
  }

  it('allows approve_doc to change status without granting metadata editing', async () => {
    const { service, content } = createService(['approve_doc']);

    await expect(
      service.updateDocument(userId, 'workspace', contentId, { status: 'published' }),
    ).resolves.toEqual({ id: contentId });
    await expect(
      service.updateDocument(userId, 'workspace', contentId, { title: 'Không được phép' }),
    ).rejects.toBeInstanceOf(NotAuthorized);
    expect(content.updateDocument).toHaveBeenCalledTimes(1);
  });

  it('does not let delete_doc approve a document', async () => {
    const { service } = createService(['delete_doc']);

    await expect(
      service.updateDocument(userId, 'workspace', contentId, { status: 'published' }),
    ).rejects.toBeInstanceOf(NotAuthorized);
  });

  it('allows edit_doc to edit metadata without granting approval', async () => {
    const { service, content } = createService(['edit_doc']);

    await expect(
      service.updateDocument(userId, 'workspace', contentId, { title: 'Tiêu đề mới' }),
    ).resolves.toEqual({ id: contentId });
    await expect(
      service.updateDocument(userId, 'workspace', contentId, { status: 'published' }),
    ).rejects.toBeInstanceOf(NotAuthorized);
    expect(content.updateDocument).toHaveBeenCalledTimes(1);
  });

  it('allows assign_exercise to update assignment fields only', async () => {
    const { service, content } = createService(['assign_exercise']);

    await expect(
      service.updateExercise(userId, 'workspace', contentId, { memberIds: [contentId] }),
    ).resolves.toEqual({ updated: true });
    await expect(
      service.updateExercise(userId, 'workspace', contentId, { title: 'Không được phép' }),
    ).rejects.toBeInstanceOf(NotAuthorized);
    expect(content.updateExercise).toHaveBeenCalledTimes(1);
  });

  it('allows edit_own_exercise to edit own content but not assignments', async () => {
    const { service, content } = createService(['edit_own_exercise']);
    content.exerciseDetail.mockResolvedValue({
      id: contentId,
      authorId: userId,
      publicationStatus: 'published',
      assignmentMemberIds: [],
    });

    await expect(
      service.updateExercise(userId, 'workspace', contentId, { title: 'Bài của tôi' }),
    ).resolves.toEqual({ updated: true });
    await expect(
      service.updateExercise(userId, 'workspace', contentId, { memberIds: [contentId] }),
    ).rejects.toBeInstanceOf(NotAuthorized);
  });

  it('does not let edit_exercise delete another author exercise', async () => {
    const { service } = createService(['edit_exercise']);

    await expect(service.deleteExercise(userId, 'workspace', contentId)).rejects.toBeInstanceOf(
      NotAuthorized,
    );
  });

  it('allows delete_exercise to remove any exercise without granting content editing', async () => {
    const { service, content } = createService(['delete_exercise']);

    await expect(service.deleteExercise(userId, 'workspace', contentId, { reason: 'Không còn phù hợp' })).resolves.toBeUndefined();
    await expect(
      service.updateExercise(userId, 'workspace', contentId, { title: 'Không được phép' }),
    ).rejects.toBeInstanceOf(NotAuthorized);
    expect(content.softDeleteExercise).toHaveBeenCalledTimes(1);
  });
});

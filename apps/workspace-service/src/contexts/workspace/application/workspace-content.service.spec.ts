import { NotAuthorized, QuotaExceeded } from '@codementor/kernel';
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

describe('WorkspaceContentService uploads against the owner plan', () => {
  const MB = 1024 ** 2;
  const ownerId = '10000000-0000-4000-8000-000000000009';
  const groupId = '20000000-0000-4000-8000-000000000002';
  const key = `docs/workspaces/${groupId}/file.pdf`;
  const permissions = Object.fromEntries(WORKSPACE_PERMISSIONS.map((p) => [p, true])) as EffectivePermissions;
  const free = { source: 'free', planName: 'Free', maxOwnedGroups: 1, maxMembersPerGroup: 10, maxStorageBytes: 100 * MB, maxUploadBytes: 10 * MB };

  function setup(usage = { ownedGroups: 1, storedBytes: 0, reservedBytes: 0 }) {
    const workspaces = {
      detail: jest.fn().mockResolvedValue({
        id: groupId,
        owner: { id: ownerId },
        currentMembership: { id: 'm', role: 'member', permissions },
      }),
    };
    const content = { createDocument: jest.fn().mockResolvedValue({ id: 'doc' }) };
    const quota = {
      snapshot: jest.fn().mockResolvedValue({ entitlements: free, usage }),
      // Run the guard the way the repository does: against the snapshot read under lock.
      reserveUpload: jest.fn(async (input: { guard: (s: unknown) => void }) => input.guard({ entitlements: free, usage })),
      isDocumentKeyInUse: jest.fn().mockResolvedValue(false),
    };
    const storage = {
      presignDocumentUpload: jest.fn().mockResolvedValue({ isFail: false, value: { objectKey: key, uploadUrl: 'u' } }),
      uploadUrlTtlSeconds: 900,
      isDocumentKeyFor: jest.fn().mockReturnValue(true),
      objectSize: jest.fn().mockResolvedValue(4 * MB),
      maxDocumentUploadBytes: 50 * MB,
    };
    const service = new WorkspaceContentService(
      workspaces as never,
      content as never,
      quota as never,
      storage as never,
      {} as never,
      { publish: jest.fn() } as never,
    );
    return { service, content, quota, storage };
  }

  it('reserves the signed size against the group owner, not the uploader', async () => {
    const { service, quota } = setup();
    await service.presign('uploader', 'g', { filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: 4 * MB } as never);
    expect(quota.reserveUpload).toHaveBeenCalledWith(expect.objectContaining({ ownerId, groupId, objectKey: key, bytes: 4 * MB }));
  });

  it('refuses a file above the plan limit before handing out a URL that works', async () => {
    const { service } = setup();
    await expect(
      service.presign('uploader', 'g', { filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: 11 * MB } as never),
    ).rejects.toMatchObject({ code: 'WORKSPACE_FILE_SIZE_EXCEEDED' });
  });

  it('refuses when the remaining storage is too small', async () => {
    const { service } = setup({ ownedGroups: 1, storedBytes: 98 * MB, reservedBytes: 0 });
    await expect(
      service.presign('uploader', 'g', { filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: 5 * MB } as never),
    ).rejects.toBeInstanceOf(QuotaExceeded);
  });

  it('records the size stored in S3, not the size in the request', async () => {
    const { service, content } = setup();
    await service.createDocument('uploader', 'g', { title: 'T', docType: 'PDF', sizeBytes: 1, storageKey: key, url: 'u' } as never);
    expect(content.createDocument).toHaveBeenCalledWith(groupId, expect.objectContaining({ sizeBytes: 4 * MB }), expect.objectContaining({ ownerId }));
  });

  it('refuses to register the same stored object twice', async () => {
    const { service, quota, content } = setup();
    quota.isDocumentKeyInUse.mockResolvedValue(true);
    await expect(
      service.createDocument('uploader', 'g', { title: 'T', docType: 'PDF', sizeBytes: 1, storageKey: key, url: 'u' } as never),
    ).rejects.toThrow('đã được thêm');
    expect(content.createDocument).not.toHaveBeenCalled();
  });
});

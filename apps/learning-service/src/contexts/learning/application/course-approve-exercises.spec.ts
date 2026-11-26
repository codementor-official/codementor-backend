import { CourseUseCases } from './course.usecases';
import type { AuthenticatedUser } from '@codementor/platform';

// Không nạp JWT adapter (jwks-rsa kéo theo jose chỉ có ESM): chỉ cần luật sở hữu thật.
jest.mock('@codementor/platform', () => {
  const ownership = jest.requireActual('../../../../../../libs/platform/src/auth/ownership');
  return { ...ownership, ObjectStorageService: class {}, ContentAuthorLookup: class {}, PrismaService: class {} };
});

describe('CourseUseCases.moderate — bài code đi kèm', () => {
  const admin: AuthenticatedUser = {
    id: '00000000-0000-4000-8000-000000000009', externalId: 'kc', displayName: 'Admin', role: 'admin', actorType: 'human',
  };
  const lesson = (exerciseId: string | null, exerciseStatus: string | null, exerciseAuthorId: string | null) => ({
    id: `l-${exerciseId}`, title: `Bài ${exerciseId}`, type: 'exercise', exerciseId, exerciseStatus, exerciseAuthorId,
  });

  const build = (approve = jest.fn()) => {
    const save = jest.fn();
    const course = { id: 'c1', createdBy: 'gv', updatedAt: new Date(), moderate: () => ({ isFail: false }), tagIds: [] };
    const useCases = new CourseUseCases(
      {
        findById: jest.fn().mockResolvedValue(course),
        findCurriculum: jest.fn().mockResolvedValue([
          { lessons: [lesson('nhap', 'draft', 'gv'), lesson('nhap', 'draft', 'gv'), lesson('roi', 'published', 'gv')] },
          { lessons: [lesson('cho', 'pending_review', 'gv'), lesson('nguoi-khac', 'draft', 'x'), lesson(null, null, null)] },
        ]),
        save,
        authorNameOf: jest.fn(),
      } as never,
      {} as never,
      { publish: jest.fn() } as never,
      { find: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      {} as never,
      { approve } as never,
    );
    return { useCases, approve, save };
  };

  it('duyệt khoá thì duyệt bài chưa công khai của tác giả, mỗi bài một lần', async () => {
    const { useCases, approve, save } = build();
    await useCases.moderate(admin, 'c1', 'approve', null, 'Bearer t').catch(() => undefined);
    expect(approve.mock.calls).toEqual([['nhap', 'Bearer t'], ['cho', 'Bearer t']]);
    expect(save).toHaveBeenCalled();
  });

  it('một bài không duyệt được thì khoá không được duyệt, lỗi nêu tên bài', async () => {
    const { useCases, save } = build(jest.fn().mockRejectedValue(new Error('thiếu test case')));
    await expect(useCases.moderate(admin, 'c1', 'approve', null, 'Bearer t')).rejects.toThrow(/Bài nhap.*thiếu test case/);
    expect(save).not.toHaveBeenCalled();
  });

  it('từ chối khoá thì không đụng bài code', async () => {
    const { useCases, approve } = build();
    await useCases.moderate(admin, 'c1', 'reject', 'chưa đạt', 'Bearer t').catch(() => undefined);
    expect(approve).not.toHaveBeenCalled();
  });
});

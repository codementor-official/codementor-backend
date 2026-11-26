import { CourseUseCases } from './course.usecases';
import type { AuthenticatedUser } from '@codementor/platform';

// Không nạp JWT adapter (jwks-rsa kéo theo jose chỉ có ESM): chỉ cần luật sở hữu thật.
jest.mock('@codementor/platform', () => {
  const ownership = jest.requireActual('../../../../../../libs/platform/src/auth/ownership');
  return { ...ownership, ObjectStorageService: class {}, ContentAuthorLookup: class {}, PrismaService: class {} };
});

describe('CourseUseCases — khoá trả phí nhận mọi URL video', () => {
  const lecturer: AuthenticatedUser = {
    id: '00000000-0000-4000-8000-000000000001', externalId: 'kc', displayName: 'GV', role: 'lecturer', actorType: 'human',
  };
  const media = { url: 'https://www.youtube.com/watch?v=1', captionsUrl: 'https://example.com/c.vtt' };
  const lesson = { id: 'l1', title: 'Video công khai', type: 'video', isPreview: false, exerciseId: null, contentRef: 'ref' };

  const build = (submit = () => ({ isFail: true, error: new Error('tới luật khoá học') })) => {
    const upsert = jest.fn().mockResolvedValue('ref');
    const useCases = new CourseUseCases(
      {
        findById: jest.fn().mockResolvedValue({ id: 'c1', createdBy: lecturer.id, isLockedForReview: false, submit }),
        findCurriculum: jest.fn().mockResolvedValue([{ lessons: [lesson] }]),
      } as never,
      { findByLessonId: jest.fn().mockResolvedValue({ media }), upsert } as never,
      {} as never,
      {} as never,
      {} as never,
      { offer: jest.fn().mockResolvedValue({ priceVnd: 199000, pendingPriceVnd: null }) } as never,
      {} as never,
    );
    return { useCases, upsert };
  };

  it('lưu được bài video URL công khai', async () => {
    const { useCases, upsert } = build();
    await useCases.saveLessonContent(lecturer, 'c1', 'l1', { media } as never);
    expect(upsert).toHaveBeenCalledWith('l1', { media });
  });

  it('gửi duyệt không bị chặn vì video', async () => {
    const { useCases } = build();
    await expect(useCases.submit(lecturer, 'c1')).rejects.toThrow('tới luật khoá học');
  });
});

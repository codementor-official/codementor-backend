import { CourseUseCases } from './course.usecases';
import type { AuthenticatedUser } from '@codementor/platform';

// Không nạp JWT adapter (jwks-rsa kéo theo jose chỉ có ESM): chỉ cần luật sở hữu thật.
jest.mock('@codementor/platform', () => {
  const ownership = jest.requireActual('../../../../../../libs/platform/src/auth/ownership');
  return { ...ownership, ObjectStorageService: class {}, ContentAuthorLookup: class {}, PrismaService: class {} };
});

describe('CourseUseCases.submit — video của khoá trả phí', () => {
  const lecturer: AuthenticatedUser = {
    id: '00000000-0000-4000-8000-000000000001', externalId: 'kc', displayName: 'GV', role: 'lecturer', actorType: 'human',
  };
  const lesson = (id: string, title: string, type: string) => ({ id, title, type, isPreview: false, exerciseId: null, contentRef: 'ref' });

  it('chỉ chặn bài VIDEO, nêu tên bài; bỏ qua media sót lại trên bài lý thuyết', async () => {
    const contents = {
      // Cả hai bài đều mang URL công khai; bài lý thuyết là dữ liệu cũ mà studio không cho gỡ.
      findByLessonId: jest.fn().mockResolvedValue({ media: { url: 'https://example.com/v.mp4', captionsUrl: 'https://example.com/c.vtt' } }),
    };
    const useCases = new CourseUseCases(
      {
        findById: jest.fn().mockResolvedValue({ id: 'c1', createdBy: lecturer.id }),
        findCurriculum: jest.fn().mockResolvedValue([
          { lessons: [lesson('l1', 'Lý thuyết cũ', 'article'), lesson('l2', 'Video công khai', 'video')] },
        ]),
      } as never,
      contents as never,
      {} as never,
      {} as never,
      {} as never,
      { offer: jest.fn().mockResolvedValue({ priceVnd: 199000 }) } as never,
    );

    const error = await useCases.submit(lecturer, 'c1').catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('"Video công khai"');
    expect((error as Error).message).not.toContain('Lý thuyết cũ');
    expect(contents.findByLessonId).toHaveBeenCalledTimes(1);
    expect(contents.findByLessonId).toHaveBeenCalledWith('l2');
  });
});

import { deriveLessonSources, validateCurriculum, type ChapterDraft, type OrderedChapter } from './curriculum';

function lesson(id: string, title: string): ChapterDraft['lessons'][number] {
  return {
    id,
    title,
    type: 'article',
    durationMinutes: 10,
    isPreview: false,
    isOptional: false,
    exerciseId: null,
  };
}

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('validateCurriculum', () => {
  it('vẫn hợp lệ khi không còn trường prerequisites nào cả', () => {
    const tree: ChapterDraft[] = [
      { title: 'Chương 1', description: null, isOptional: false, lessons: [lesson(A, 'Bài 1'), lesson(B, 'Bài 2')] },
    ];
    expect(validateCurriculum(tree).isOk).toBe(true);
  });

  it('từ chối bài code bị gắn hai lần trong cùng một chương', () => {
    const tree: ChapterDraft[] = [
      {
        title: 'Chương 1',
        description: null,
        isOptional: false,
        lessons: [
          { ...lesson(A, 'Bài 1'), type: 'exercise', exerciseId: C },
          { ...lesson(B, 'Bài 2'), type: 'exercise', exerciseId: C },
        ],
      },
    ];
    expect(validateCurriculum(tree).isFail).toBe(true);
  });
});

describe('deriveLessonSources — suy cạnh phụ thuộc từ thứ tự', () => {
  it('bài đầu khóa học không có điều kiện', () => {
    const chapters: OrderedChapter[] = [{ lessons: [{ id: A, skipOrder: false }] }];
    expect(deriveLessonSources(chapters).has(A)).toBe(false);
  });

  it('bài N cần bài N-1 cùng chương', () => {
    const chapters: OrderedChapter[] = [
      { lessons: [{ id: A, skipOrder: false }, { id: B, skipOrder: false }] },
    ];
    expect(deriveLessonSources(chapters).get(B)).toEqual([A]);
  });

  it('bài đầu một chương (không phải chương đầu) cần TOÀN BỘ bài chương trước', () => {
    const chapters: OrderedChapter[] = [
      { lessons: [{ id: A, skipOrder: false }, { id: B, skipOrder: false }] },
      { lessons: [{ id: C, skipOrder: false }] },
    ];
    expect(deriveLessonSources(chapters).get(C)).toEqual([A, B]);
  });

  it('"cho học trước" (isPreview) bỏ hẳn điều kiện của bài đó, không ảnh hưởng bài sau nó', () => {
    const D = '44444444-4444-4444-8444-444444444444';
    const chapters: OrderedChapter[] = [
      {
        lessons: [
          { id: A, skipOrder: false },
          { id: B, skipOrder: true },
          { id: C, skipOrder: false },
        ],
      },
      { lessons: [{ id: D, skipOrder: false }] },
    ];
    const sources = deriveLessonSources(chapters);
    expect(sources.has(B)).toBe(false);
    // Bài C vẫn cần bài B (liền trước nó), dù B tự nó mở ngay không cần A.
    expect(sources.get(C)).toEqual([B]);
    expect(sources.get(D)).toEqual([A, B, C]);
  });
});

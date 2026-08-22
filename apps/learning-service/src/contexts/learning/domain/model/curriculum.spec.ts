import {
  deriveEarlyAccessFlags,
  deriveLessonSources,
  validateCurriculum,
  type ChapterDraft,
  type OrderedChapter,
  type StoredChapterEdges,
} from './curriculum';

function lesson(id: string, title: string, earlyAccess = false): ChapterDraft['lessons'][number] {
  return {
    id,
    title,
    type: 'article',
    durationMinutes: 10,
    isPreview: false,
    isOptional: false,
    exerciseId: null,
    earlyAccess,
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
    const chapters: OrderedChapter[] = [{ lessons: [{ id: A, earlyAccess: false }] }];
    expect(deriveLessonSources(chapters).has(A)).toBe(false);
  });

  it('bài N cần bài N-1 cùng chương', () => {
    const chapters: OrderedChapter[] = [
      { lessons: [{ id: A, earlyAccess: false }, { id: B, earlyAccess: false }] },
    ];
    expect(deriveLessonSources(chapters).get(B)).toEqual([A]);
  });

  it('bài đầu một chương (không phải chương đầu) cần TOÀN BỘ bài chương trước', () => {
    const chapters: OrderedChapter[] = [
      { lessons: [{ id: A, earlyAccess: false }, { id: B, earlyAccess: false }] },
      { lessons: [{ id: C, earlyAccess: false }] },
    ];
    expect(deriveLessonSources(chapters).get(C)).toEqual([A, B]);
  });

  it('"cho học trước" bỏ hẳn điều kiện của bài đó, không ảnh hưởng bài sau nó', () => {
    const D = '44444444-4444-4444-8444-444444444444';
    const chapters: OrderedChapter[] = [
      {
        lessons: [
          { id: A, earlyAccess: false },
          { id: B, earlyAccess: true },
          { id: C, earlyAccess: false },
        ],
      },
      { lessons: [{ id: D, earlyAccess: false }] },
    ];
    const sources = deriveLessonSources(chapters);
    expect(sources.has(B)).toBe(false);
    // Bài C vẫn cần bài B (liền trước nó), dù B tự nó mở ngay không cần A.
    expect(sources.get(C)).toEqual([B]);
    expect(sources.get(D)).toEqual([A, B, C]);
  });
});

describe('deriveEarlyAccessFlags — chiều ngược, đọc lại cho studio', () => {
  it('khóa ở chế độ linear/free: mọi bài đều false, bất kể cạnh lưu gì', () => {
    const chapters: StoredChapterEdges[] = [
      { lessons: [{ id: A, prerequisites: { rule: 'ALL', lessonIds: [] } }] },
    ];
    expect(deriveEarlyAccessFlags(chapters, 'linear').get(A)).toBe(false);
    expect(deriveEarlyAccessFlags(chapters, 'free').get(A)).toBe(false);
  });

  it('khóa ở graph: bài không có cạnh và không phải bài đầu khóa → true', () => {
    const chapters: StoredChapterEdges[] = [
      {
        lessons: [
          { id: A, prerequisites: { rule: 'ALL', lessonIds: [] } },
          { id: B, prerequisites: { rule: 'ALL', lessonIds: [] } },
        ],
      },
    ];
    const flags = deriveEarlyAccessFlags(chapters, 'graph');
    // Bài đầu khóa luôn false dù không có cạnh — nó vốn dĩ đã mở ngay theo lẽ tự nhiên.
    expect(flags.get(A)).toBe(false);
    expect(flags.get(B)).toBe(true);
  });

  it('khóa ở graph: bài có cạnh → false', () => {
    const chapters: StoredChapterEdges[] = [
      {
        lessons: [
          { id: A, prerequisites: { rule: 'ALL', lessonIds: [] } },
          { id: B, prerequisites: { rule: 'ALL', lessonIds: [A] } },
        ],
      },
    ];
    expect(deriveEarlyAccessFlags(chapters, 'graph').get(B)).toBe(false);
  });
});

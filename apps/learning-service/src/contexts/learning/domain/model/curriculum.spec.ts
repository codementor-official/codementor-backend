import {
  deriveLessonSources,
  lessonDurationConflict,
  validateCurriculum,
  type ChapterDraft,
  type OrderedChapter,
} from './curriculum';

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

describe('lessonDurationConflict', () => {
  it('cho qua khi thời lượng bài dài hơn video', () => {
    expect(lessonDurationConflict(15, 754)).toBeNull();
  });

  it('cho qua khi vừa khít', () => {
    expect(lessonDurationConflict(10, 600)).toBeNull();
  });

  it('chặn khi bài ngắn hơn video, và nói ra số phút tối thiểu', () => {
    const message = lessonDurationConflict(10, 754);
    expect(message).toContain('ngắn hơn video');
    // 754 giây = 12 phút 34 → phải làm tròn LÊN 13, làm tròn xuống là vẫn thiếu chỗ.
    expect(message).toContain('13 phút');
  });

  it('một phút là đủ cho video ngắn hơn một phút', () => {
    expect(lessonDurationConflict(1, 20)).toBeNull();
    // Tối thiểu luôn là 1 phút, không bao giờ là 0 — `ceil(20/60)` ra 1.
    expect(lessonDurationConflict(0, 20)).toContain('tối thiểu 1 phút');
  });

  // Chưa biết thì không chặn — chặn khi chưa biết là biến một lần SDK hỏng thành một bài
  // học không lưu được.
  it('bỏ qua khi chưa biết thời lượng bài', () => {
    expect(lessonDurationConflict(null, 754)).toBeNull();
  });

  it('bỏ qua khi chưa đo được video', () => {
    expect(lessonDurationConflict(5, null)).toBeNull();
    expect(lessonDurationConflict(5, undefined)).toBeNull();
    expect(lessonDurationConflict(5, 0)).toBeNull();
  });
});

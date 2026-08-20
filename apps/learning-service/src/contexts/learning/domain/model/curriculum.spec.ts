import { validateCurriculum, type ChapterDraft, type LessonPrerequisites } from './curriculum';

/** Bài đã lưu — có `id`, nên trỏ tới nó được. */
function lesson(
  id: string,
  title: string,
  prerequisites?: LessonPrerequisites,
): ChapterDraft['lessons'][number] {
  return {
    id,
    title,
    type: 'article',
    durationMinutes: 10,
    isPreview: false,
    isOptional: false,
    exerciseId: null,
    ...(prerequisites ? { prerequisites } : {}),
  };
}

function chapter(lessons: ChapterDraft['lessons']): ChapterDraft[] {
  return [{ title: 'Chương 1', description: null, isOptional: false, lessons }];
}

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('điều kiện mở khoá bài học', () => {
  it('chấp nhận chuỗi thẳng bài 1 → bài 2 → bài 3', () => {
    const tree = chapter([
      lesson(A, 'Bài 1'),
      lesson(B, 'Bài 2', { rule: 'ALL', lessonIds: [A] }),
      lesson(C, 'Bài 3', { rule: 'ALL', lessonIds: [B] }),
    ]);
    expect(validateCurriculum(tree).isOk).toBe(true);
  });

  // Đúng hình dạng đề bài yêu cầu: xong bài 1 mở cả 2 và 3, phải xong CẢ HAI mới mở bài 4.
  it('chấp nhận rẽ nhánh rồi gộp lại bằng luật ALL', () => {
    const D = '44444444-4444-4444-8444-444444444444';
    const tree = chapter([
      lesson(A, 'Bài 1'),
      lesson(B, 'Bài 2', { rule: 'ALL', lessonIds: [A] }),
      lesson(C, 'Bài 3', { rule: 'ALL', lessonIds: [A] }),
      lesson(D, 'Bài 4', { rule: 'ALL', lessonIds: [B, C] }),
    ]);
    expect(validateCurriculum(tree).isOk).toBe(true);
  });

  it('từ chối bài lấy chính nó làm điều kiện', () => {
    const tree = chapter([lesson(A, 'Bài 1', { rule: 'ALL', lessonIds: [A] })]);
    expect(validateCurriculum(tree).isFail).toBe(true);
  });

  it('từ chối điều kiện trỏ ra ngoài khóa học', () => {
    const outsider = '99999999-9999-4999-8999-999999999999';
    const tree = chapter([lesson(A, 'Bài 1', { rule: 'ALL', lessonIds: [outsider] })]);
    expect(validateCurriculum(tree).isFail).toBe(true);
  });

  // Lỗi im lặng tệ nhất trong nhóm này: lưu thì trót lọt, chỉ là không bài nào mở ra được.
  it('từ chối vòng lặp gián tiếp A → B → C → A và chỉ đúng vòng lặp đó', () => {
    const tree = chapter([
      lesson(A, 'Bài 1', { rule: 'ALL', lessonIds: [C] }),
      lesson(B, 'Bài 2', { rule: 'ALL', lessonIds: [A] }),
      lesson(C, 'Bài 3', { rule: 'ALL', lessonIds: [B] }),
    ]);
    const result = validateCurriculum(tree);
    expect(result.isFail).toBe(true);
    for (const title of ['Bài 1', 'Bài 2', 'Bài 3']) {
      expect(result.error.message).toContain(title);
    }
  });

  it('từ chối đặt điều kiện cho bài chưa từng được lưu', () => {
    const tree = chapter([
      lesson(A, 'Bài 1'),
      {
        title: 'Bài mới',
        type: 'article',
        durationMinutes: null,
        isPreview: false,
        isOptional: false,
        exerciseId: null,
        prerequisites: { rule: 'ALL', lessonIds: [A] },
      },
    ]);
    expect(validateCurriculum(tree).isFail).toBe(true);
  });

  // Studio cũ không gửi trường này; cây phải hợp lệ y như trước.
  it('cây không có điều kiện nào vẫn hợp lệ', () => {
    expect(validateCurriculum(chapter([lesson(A, 'Bài 1'), lesson(B, 'Bài 2')])).isOk).toBe(true);
  });
});

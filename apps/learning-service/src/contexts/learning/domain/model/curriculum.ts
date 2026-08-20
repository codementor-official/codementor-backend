import { BusinessRuleViolation, InvalidInput, Result } from '@codementor/kernel';

/** Khớp enum `lesson_type` trong PostgreSQL. */
export const LESSON_TYPES = ['video', 'article', 'exercise', 'quiz', 'challenge', 'project'] as const;
export type LessonType = (typeof LESSON_TYPES)[number];

/**
 * Bài chỉ được trỏ tới bài code khi thuộc mấy kiểu này — khớp CHECK
 * `lessons_exercise_only_for_exercise_types` ở CSDL. Kiểm ở đây để lỗi ra 400 kèm tên
 * trường thay vì SQLSTATE 23514 từ driver.
 */
const EXERCISE_BEARING: LessonType[] = ['exercise', 'quiz', 'challenge', 'project'];

export function bearsExercise(type: LessonType): boolean {
  return EXERCISE_BEARING.includes(type);
}

/**
 * Điều kiện mở một bài, ở dạng người soạn nghĩ: "phải xong TẤT CẢ" hoặc "chỉ cần MỘT".
 *
 * Bảng `lesson_prerequisites` lưu dạng tổng quát hơn — DNF, `group_index` gom các cạnh
 * lại: cùng nhóm là AND, khác nhóm là OR (xem `fn_lesson_available` ở migration 0011).
 * Hai dạng đó quy về nhau đúng như sau:
 *
 *   ALL {a,b,c}  →  một nhóm duy nhất  (a ∧ b ∧ c)
 *   ANY {a,b,c}  →  ba nhóm một phần tử  (a) ∨ (b) ∨ (c)
 *
 * Giới hạn có chủ ý: dạng này KHÔNG diễn đạt được DNF trộn, kiểu `(a ∧ b) ∨ c`. CSDL vẫn
 * chứa được, nhưng chưa có đường nào soạn ra nó và một trình soạn đồ thị đầy đủ là một
 * màn hình khác hẳn. Cần tới lúc đó thì đổi `rule` thành danh sách nhóm, tầng CSDL không
 * phải sửa gì.
 */
export type PrerequisiteRule = 'ALL' | 'ANY';

export interface LessonPrerequisites {
  rule: PrerequisiteRule;
  /** Rỗng = không có điều kiện, bài mở ngay. */
  lessonIds: string[];
}

export const NO_PREREQUISITES: LessonPrerequisites = { rule: 'ALL', lessonIds: [] };

export interface LessonDraft {
  /** Có id = bài đang tồn tại, giữ nguyên hàng. Không có = bài mới. */
  id?: string;
  title: string;
  type: LessonType;
  durationMinutes: number | null;
  isPreview: boolean;
  isOptional: boolean;
  exerciseId: string | null;
  /**
   * Vắng mặt = giữ nguyên những gì đang có trong CSDL. `{ lessonIds: [] }` = xoá hết.
   *
   * Phân biệt hai thứ đó là bắt buộc: studio cũ (và mọi client chưa cập nhật) gửi cây
   * không kèm trường này, và coi "không gửi" là "xoá hết" sẽ âm thầm xoá sạch điều kiện
   * mở khoá của cả khoá học ở lần lưu kế tiếp.
   */
  prerequisites?: LessonPrerequisites;
}

export interface ChapterDraft {
  id?: string;
  title: string;
  description: string | null;
  isOptional: boolean;
  lessons: LessonDraft[];
}

const MAX_TITLE = 200;

/**
 * Kiểm cả cây trước khi chạm CSDL.
 *
 * Ghi curriculum là một transaction dài; để CSDL bắt lỗi thì nó rollback cả cây và
 * thông điệp trả về là tên constraint, không nói được chương nào bài nào.
 */
export function validateCurriculum(
  chapters: ChapterDraft[],
): Result<true, InvalidInput | BusinessRuleViolation> {
  const chapterIds = new Set<string>();
  const lessonIds = new Set<string>();

  for (const [chapterIndex, chapter] of chapters.entries()) {
    const where = `chương ${chapterIndex + 1}`;

    if (!chapter.title.trim()) {
      return Result.fail(new InvalidInput(`Tiêu đề ${where} không được để trống`));
    }
    if (chapter.title.length > MAX_TITLE) {
      return Result.fail(new InvalidInput(`Tiêu đề ${where} tối đa ${MAX_TITLE} ký tự`));
    }
    if (chapter.id) {
      if (chapterIds.has(chapter.id)) {
        return Result.fail(new InvalidInput(`Chương ${chapter.id} xuất hiện hai lần`));
      }
      chapterIds.add(chapter.id);
    }

    const exercisesHere = new Set<string>();
    for (const [lessonIndex, lesson] of chapter.lessons.entries()) {
      const at = `bài ${lessonIndex + 1} của ${where}`;

      if (!lesson.title.trim()) {
        return Result.fail(new InvalidInput(`Tiêu đề ${at} không được để trống`));
      }
      if (lesson.durationMinutes !== null && lesson.durationMinutes <= 0) {
        return Result.fail(new InvalidInput(`Thời lượng ${at} phải lớn hơn 0`));
      }
      if (lesson.exerciseId && !bearsExercise(lesson.type)) {
        return Result.fail(
          new InvalidInput(`${at} kiểu "${lesson.type}" không gắn được bài code`),
        );
      }
      if (lesson.id) {
        if (lessonIds.has(lesson.id)) {
          return Result.fail(new InvalidInput(`Bài ${lesson.id} xuất hiện hai lần`));
        }
        lessonIds.add(lesson.id);
      }

      // Khớp partial unique index `lessons_exercise_unique_per_chapter` từ migration 0018.
      // Tiến độ khoá theo (user, exercise) nên hai ô cùng một bài thì một ô không bao giờ
      // xong được.
      if (lesson.exerciseId) {
        if (exercisesHere.has(lesson.exerciseId)) {
          return Result.fail(
            new BusinessRuleViolation(`Một bài code được thêm hai lần vào ${where}`),
          );
        }
        exercisesHere.add(lesson.exerciseId);
      }
    }
  }

  return validatePrerequisites(chapters, lessonIds);
}

/**
 * Điều kiện mở khoá: nguồn phải là bài có thật trong chính khoá này, không tự trỏ, và
 * đồ thị không được có chu trình.
 *
 * CSDL đã chặn cả ba (FK ghép `(course_id, id)`, CHECK `source <> target`, và trigger
 * `fn_prevent_dependency_cycle` ở migration 0010). Kiểm lại ở đây KHÔNG thừa: lệnh ghi
 * curriculum là một transaction dài, để CSDL bắt thì cả cây bị rollback và thứ hiện lên
 * màn hình người soạn là tên một constraint, không nói được bài nào trỏ vào bài nào.
 *
 * Chu trình là lỗi im lặng tệ nhất trong nhóm này: nó không làm hỏng gì lúc lưu, chỉ
 * khiến một nhóm bài không bao giờ mở ra được cho bất kỳ học viên nào.
 */
function validatePrerequisites(
  chapters: ChapterDraft[],
  knownLessonIds: Set<string>,
): Result<true, InvalidInput | BusinessRuleViolation> {
  const titleOf = new Map<string, string>();
  /** target → mọi nguồn, bất kể ALL hay ANY: chu trình không quan tâm luật gom nhóm. */
  const edges = new Map<string, string[]>();

  for (const [chapterIndex, chapter] of chapters.entries()) {
    for (const [lessonIndex, lesson] of chapter.lessons.entries()) {
      const at = `bài ${lessonIndex + 1} của chương ${chapterIndex + 1}`;
      if (lesson.id) titleOf.set(lesson.id, lesson.title.trim() || at);

      const sources = lesson.prerequisites?.lessonIds ?? [];
      if (sources.length === 0) continue;

      // Bài chưa lưu lần nào chưa có id, nên chưa có gì trỏ tới nó được — và nó cũng
      // chưa trỏ đi đâu được, vì cạnh cần cả hai đầu là hàng có thật.
      if (!lesson.id) {
        return Result.fail(
          new BusinessRuleViolation(
            `Lưu ${at} trước rồi mới đặt được điều kiện mở khoá cho nó`,
          ),
        );
      }
      for (const source of sources) {
        if (source === lesson.id) {
          return Result.fail(new InvalidInput(`${at} không thể là điều kiện của chính nó`));
        }
        if (!knownLessonIds.has(source)) {
          return Result.fail(
            new InvalidInput(`Điều kiện của ${at} trỏ tới một bài không thuộc khóa học này`, {
              lessonId: source,
            }),
          );
        }
      }
      edges.set(lesson.id, [...new Set(sources)]);
    }
  }

  const cycle = findCycle(edges);
  if (cycle) {
    const names = cycle.map((id) => `“${titleOf.get(id) ?? id}”`).join(' → ');
    return Result.fail(
      new BusinessRuleViolation(
        `Điều kiện mở khoá tạo thành vòng lặp: ${names}. Những bài này sẽ không bao giờ mở ra được.`,
      ),
    );
  }

  return Result.ok(true);
}

/**
 * DFS ba màu. Trả về chính vòng lặp tìm được (đã khép kín) để câu báo lỗi chỉ đúng chỗ
 * người soạn phải sửa, thay vì chỉ nói "có vòng lặp ở đâu đó".
 */
function findCycle(edges: Map<string, string[]>): string[] | null {
  const VISITING = 1;
  const DONE = 2;
  const state = new Map<string, number>();
  const stack: string[] = [];

  const walk = (node: string): string[] | null => {
    state.set(node, VISITING);
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      if (state.get(next) === DONE) continue;
      if (state.get(next) === VISITING) return [...stack.slice(stack.indexOf(next)), next];
      const found = walk(next);
      if (found) return found;
    }
    stack.pop();
    state.set(node, DONE);
    return null;
  };

  for (const node of edges.keys()) {
    if (state.get(node) === undefined) {
      const found = walk(node);
      if (found) return found;
    }
  }
  return null;
}

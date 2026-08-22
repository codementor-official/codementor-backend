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
 * Dạng CSDL của điều kiện mở một bài — bảng `lesson_prerequisites` là DNF, `group_index`
 * gom các cạnh (cùng nhóm là AND, khác nhóm là OR). Máy suy tự động ở dưới đây chỉ bao giờ
 * viết MỘT nhóm cho mỗi bài (toàn AND), nên `rule` luôn là hằng `'ALL'` — giữ lại type này
 * chỉ để đọc lại đúng hình dạng bảng, không còn ai CHỌN luật nữa.
 */
export interface LessonPrerequisites {
  rule: 'ALL' | 'ANY';
  lessonIds: string[];
}

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
   * "Cho học trước": bài này mở ngay, không cần bài liền trước (cùng chương) hay cả
   * chương liền trước (nếu là bài đầu chương) hoàn thành. Thay hẳn cho việc tác giả tự
   * chọn từng bài làm điều kiện — server tự suy cạnh phụ thuộc từ thứ tự chương/bài, xem
   * `deriveLessonSources`.
   */
  earlyAccess: boolean;
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

  return Result.ok(true);
}

/** Bài đủ để tính thứ tự — id thật (server tự sinh cho bài mới trước khi gọi hàm này) và
 * có "cho học trước" hay không. */
export interface OrderedLesson {
  id: string;
  earlyAccess: boolean;
}

export interface OrderedChapter {
  lessons: OrderedLesson[];
}

/**
 * Suy cạnh phụ thuộc từ thứ tự chương/bài — tuyến tính mặc định, "cho học trước" là lối
 * thoát riêng cho từng bài.
 *
 * Bài N cần bài N-1 CÙNG CHƯƠNG hoàn thành. Bài đầu một chương (trừ chương đầu) cần TOÀN
 * BỘ bài của chương liền trước — không chỉ bài cuối, vì một bài giữa chương đó có thể tự
 * nó đã "cho học trước" và phá chuỗi kéo theo. Bài được đánh "cho học trước" không có cạnh
 * nào cả — mở ngay bất kể các bài trước đã xong chưa.
 *
 * Luôn sinh ra một đồ thị không chu trình (mỗi cạnh chỉ trỏ về phía trước theo thứ tự
 * chương/bài), nên không cần kiểm chu trình như điều kiện tự chọn trước đây.
 */
export function deriveLessonSources(chapters: OrderedChapter[]): Map<string, string[]> {
  const sources = new Map<string, string[]>();

  for (const [chapterIndex, chapter] of chapters.entries()) {
    for (const [lessonIndex, lesson] of chapter.lessons.entries()) {
      if (lesson.earlyAccess) continue;

      if (lessonIndex > 0) {
        sources.set(lesson.id, [chapter.lessons[lessonIndex - 1].id]);
        continue;
      }
      if (chapterIndex > 0) {
        const previous = chapters[chapterIndex - 1].lessons.map((item) => item.id);
        if (previous.length > 0) sources.set(lesson.id, previous);
      }
      // Bài đầu tiên của cả khóa học: không có gì đứng trước để yêu cầu.
    }
  }

  return sources;
}

/** Bài như đọc lại từ CSDL — id thật và cạnh phụ thuộc đang lưu. */
export interface StoredLessonEdges {
  id: string;
  prerequisites: LessonPrerequisites;
}

export interface StoredChapterEdges {
  lessons: StoredLessonEdges[];
}

/**
 * Chiều ngược của `deriveLessonSources`: từ cạnh đang lưu, suy xem bài nào đang "cho học
 * trước" — để hiển thị lại đúng trạng thái checkbox trong studio.
 *
 * Chỉ áp dụng khi khóa học đang ở chế độ `graph`: `linear`/`free` không có khái niệm
 * "cho học trước" — mọi bài coi như bình thường (`false`), vì đó là những khóa CHƯA từng
 * đi qua studio mới (đa số khóa hiện có), không phải khóa cố ý cho phép ngoại lệ.
 *
 * Một khóa ở `graph` với cạnh KHÔNG khớp hình dạng suy được (đồ thị tự tay soạn từ studio
 * cũ) không phân biệt được chính xác — coi bài có cạnh (bất kỳ hình dạng nào) là bình
 * thường, bài không có cạnh (và không phải bài đầu khóa) là "cho học trước". Lần lưu kế
 * tiếp qua studio mới sẽ ghi đè về đúng mô hình đơn giản này.
 */
export function deriveEarlyAccessFlags(
  chapters: StoredChapterEdges[],
  progressionMode: string,
): Map<string, boolean> {
  const flags = new Map<string, boolean>();
  if (progressionMode !== 'graph') {
    for (const chapter of chapters) {
      for (const lesson of chapter.lessons) flags.set(lesson.id, false);
    }
    return flags;
  }

  const firstLessonId = chapters.find((chapter) => chapter.lessons.length > 0)?.lessons[0]?.id;
  for (const chapter of chapters) {
    for (const lesson of chapter.lessons) {
      const isFirst = lesson.id === firstLessonId;
      flags.set(lesson.id, !isFirst && lesson.prerequisites.lessonIds.length === 0);
    }
  }
  return flags;
}

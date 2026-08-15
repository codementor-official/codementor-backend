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

export interface LessonDraft {
  /** Có id = bài đang tồn tại, giữ nguyên hàng. Không có = bài mới. */
  id?: string;
  title: string;
  type: LessonType;
  durationMinutes: number | null;
  isPreview: boolean;
  isOptional: boolean;
  exerciseId: string | null;
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

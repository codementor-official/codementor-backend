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
  /**
   * "Cho học trước": bài này mở cho MỌI người, kể cả chưa ghi danh khóa học, và không cần
   * bài liền trước (cùng chương) hay cả chương liền trước (nếu là bài đầu chương) hoàn
   * thành.
   *
   * Từng là hai cờ riêng ("cho học thử" bỏ qua ghi danh, "cho học trước" bỏ qua thứ tự) —
   * gộp lại vì cờ thứ hai luôn kéo theo cờ nhất: người chưa ghi danh không có `lesson_
   * progress` nào cả, nên MỘT bài mở cho họ thì đương nhiên không thể còn đòi "đã xong bài
   * trước" — điều kiện đó với họ luôn sai. "Cho học thử" mà vẫn gác thứ tự chỉ có tác dụng
   * đúng với bài đầu tiên của khóa, vô nghĩa như một tính năng chọn-bài-bất-kỳ.
   *
   * Vẫn là cột `lessons.is_preview` phía CSDL — tên cột không đổi, chỉ đổi Ý NGHĨA áp cho
   * nó ở tầng ứng dụng. Server tự suy cạnh phụ thuộc từ thứ tự chương/bài cho các bài
   * KHÔNG mang cờ này, xem `deriveLessonSources`.
   */
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

/** Bài đủ để tính thứ tự — id thật (server tự sinh cho bài mới trước khi gọi hàm này) và
 * có "cho học trước" hay không (`isPreview` — xem `LessonDraft.isPreview`). */
export interface OrderedLesson {
  id: string;
  skipOrder: boolean;
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
      if (lesson.skipOrder) continue;

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

import type { Course } from '../model/course';
import type { ChapterDraft, LessonType } from '../model/curriculum';

export interface CourseListFilter {
  createdBy: string | null;
  publishedOnly: boolean;
  /** Hàng chờ duyệt: mọi tác giả, chỉ `pending_review`, sắp cũ trước. */
  pendingOnly?: boolean;
  level?: string;
  status?: string;
  q?: string;
  limit: number;
  cursor?: { updatedAt: Date; id: string };
}

export interface CourseListItem {
  id: string;
  slug: string;
  title: string;
  level: string;
  status: string;
  durationHours: number | null;
  totalChapters: number;
  totalLessons: number;
  createdBy: string | null;
  authorName: string | null;
  updatedAt: Date;
}

export interface StoredLesson {
  id: string;
  title: string;
  type: LessonType;
  durationMinutes: number | null;
  isPreview: boolean;
  isOptional: boolean;
  position: number;
  exerciseId: string | null;
  contentRef: string | null;
  /** Lấy kèm từ `exercises` để studio hiện tên mà không phải gọi service khác. */
  exerciseTitle: string | null;
  exerciseStatus: string | null;
  exerciseAuthorId: string | null;
}

export interface StoredChapter {
  id: string;
  title: string;
  description: string | null;
  isOptional: boolean;
  position: number;
  lessons: StoredLesson[];
}

export interface CourseRepository {
  findById(id: string): Promise<Course | null>;
  existsBySlug(slug: string): Promise<boolean>;
  list(filter: CourseListFilter): Promise<CourseListItem[]>;
  findCurriculum(courseId: string): Promise<StoredChapter[]>;
  /**
   * Ghi cả cây trong MỘT transaction, theo kiểu **so khớp** chứ không xoá sạch rồi chèn lại.
   *
   * `lesson_progress.lesson_id` là ON DELETE CASCADE: xoá một bài là xoá tiến độ của mọi
   * học viên đã học nó. Nên hàng nào còn trong cây thì giữ nguyên `id` và chỉ UPDATE;
   * chỉ hàng tác giả thực sự bỏ đi mới bị DELETE.
   */
  saveCurriculum(courseId: string, chapters: ChapterDraft[]): Promise<void>;
  /**
   * Trỏ bài học tới document vừa ghi ở MongoDB.
   *
   * Bước riêng vì thân bài nằm ở kho khác: ghi document trước rồi mới gán tham chiếu,
   * nên trường hợp xấu nhất là một document mồ côi — vô hại, vì mọi lượt đọc đều bắt
   * đầu từ PostgreSQL. Thiếu bước này thì bài có nội dung vẫn bị tính là rỗng lúc
   * kiểm điều kiện gửi duyệt.
   */
  setLessonContentRef(lessonId: string, contentRef: string): Promise<void>;
  save(course: Course): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface LessonContent {
  summary?: string;
  objectives?: string[];
  contentHtml?: string;
  exerciseBrief?: string[];
}

export interface LessonContentRepository {
  findByLessonId(lessonId: string): Promise<LessonContent | null>;
  upsert(lessonId: string, content: LessonContent): Promise<string>;
}

export const COURSE_REPOSITORY = Symbol('COURSE_REPOSITORY');
export const LESSON_CONTENT_REPOSITORY = Symbol('LESSON_CONTENT_REPOSITORY');

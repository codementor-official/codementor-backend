import type { Course } from '../model/course';
import type { ChapterDraft, LessonType } from '../model/curriculum';

export interface CourseListFilter {
  createdBy: string | null;
  publishedOnly: boolean;
  /** Hàng chờ duyệt: mọi tác giả, chỉ `pending_review`, sắp cũ trước. */
  pendingOnly?: boolean;
  /** Trang quản trị: mọi tác giả, mọi trạng thái TRỪ `draft`, trừ khi có `status` ép cụ thể. */
  excludeDraft?: boolean;
  level?: string;
  status?: string;
  /** Lọc theo giảng viên đứng tên — trang quản trị xem theo từng tác giả. */
  authorId?: string;
  updatedFrom?: Date;
  updatedTo?: Date;
  q?: string;
  limit: number;
  cursor?: { updatedAt: Date; id: string };
}

export interface CourseListItem {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  level: string;
  status: string;
  durationHours: number | null;
  totalChapters: number;
  totalLessons: number;
  createdBy: string | null;
  authorName: string | null;
  /**
   * Tác giả đang XIN GỠ nội dung này và chờ admin quyết.
   *
   * Không phải một trạng thái riêng: nội dung vẫn `published` và học viên vẫn dùng bình
   * thường. Dấu hiệu là `published` + có `rejection_reason` — xem `removalRequested` ở
   * aggregate. Có mặt trong danh sách (không chỉ ở chi tiết) vì hàng chờ duyệt phải LỌC
   * ra được chúng: thiếu nó thì một yêu cầu xin gỡ chỉ tồn tại trong thông báo, và bấm
   * vào thông báo sẽ dẫn tới một màn hình không có gì.
   */
  removalRequested: boolean;
  updatedAt: Date;
}

/**
 * Tên hiển thị của tác giả, để gắn vào sự kiện `evt.course.published.v1`.
 *
 * Cùng lối đọc mà `findMany` đã dùng (LEFT JOIN `users` chỉ để lấy `display_name`) —
 * không phải đường ghi, và cũng không phải quyền đọc mới: danh mục khóa học vốn đã
 * hiện tên tác giả theo đúng cách này.
 */
export interface AuthorNameLookup {
  authorNameOf(userId: string): Promise<string | null>;
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

export interface CourseRepository extends AuthorNameLookup {
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
  findReferencingRoadmaps(courseId: string): Promise<{ id: string; title: string; slug: string }[]>;
}

export interface LessonContent {
  summary?: string;
  objectives?: string[];
  contentHtml?: string;
  exerciseBrief?: string[];
  /**
   * Video của bài học. Khớp `media` trong validator của collection `lesson_contents`.
   *
   * KHÔNG lưu `provider`: bản thân URL đã nói ra nó là YouTube, Vimeo hay một tệp trực
   * tiếp, và giữ thêm một trường nữa là dựng ra hai chỗ có thể mâu thuẫn — đổi URL mà
   * quên đổi provider thì trình phát chọn sai kiểu nhúng. Frontend nhận diện bằng
   * `resolveVideo` ở `@codementor/utils`, dùng chung cho cả studio lẫn màn học viên.
   */
  media?: {
    url: string;
    durationSeconds?: number;
    captionsUrl?: string;
  };
}

export interface LessonContentRepository {
  findByLessonId(lessonId: string): Promise<LessonContent | null>;
  upsert(lessonId: string, content: LessonContent): Promise<string>;
}

export const COURSE_REPOSITORY = Symbol('COURSE_REPOSITORY');
export const LESSON_CONTENT_REPOSITORY = Symbol('LESSON_CONTENT_REPOSITORY');

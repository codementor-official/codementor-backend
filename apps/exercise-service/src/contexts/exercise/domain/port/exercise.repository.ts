import type { Exercise } from '../model/exercise';
import type { ExerciseContent } from '../model/exercise-content';
import type { Slug } from '../model/slug';

export interface ExerciseListFilter {
  /** `null` = kho chung (mọi tác giả). Có giá trị = chỉ bài của người đó. */
  authorId: string | null;
  /** Hàng chờ duyệt: mọi tác giả, chỉ `pending_review`. Sắp CŨ TRƯỚC. */
  pendingOnly?: boolean;
  /** Trang quản trị: mọi tác giả, mọi trạng thái TRỪ `draft`, trừ khi có `status` ép cụ thể. */
  excludeDraft?: boolean;
  kind?: string;
  difficulty?: string;
  status?: string;
  /** Chỉ dùng cho kho chung: buộc public + published. */
  publishedOnly: boolean;
  updatedFrom?: Date;
  updatedTo?: Date;
  q?: string;
  limit: number;
  cursor?: { updatedAt: Date; id: string };
}

export interface ExerciseListItem {
  id: string;
  slug: string;
  title: string;
  kind: string;
  difficulty: string;
  status: string;
  visibility: string;
  authorId: string | null;
  authorName: string | null;
  forkedFromId: string | null;
  updatedAt: Date;
}

export interface ExerciseRepository {
  findById(id: string): Promise<Exercise | null>;
  existsBySlug(slug: Slug): Promise<boolean>;
  /** Đọc dạng phẳng cho màn danh sách: aggregate không phục vụ truy vấn. */
  list(filter: ExerciseListFilter): Promise<ExerciseListItem[]>;
  save(exercise: Exercise): Promise<void>;
  delete(id: string): Promise<void>;
}

/**
 * KHÔNG có `countReferencingLessons` ở đây. Đếm số chương đang dùng một bài nghĩa là đọc
 * bảng `lessons`, thuộc learning-service — `docs/02-service-architecture.md §5` cấm đọc
 * chéo bảng. Con số đó sẽ lấy qua HTTP khi learning-service expose ở 4d. Còn việc chặn
 * xoá thì CSDL đã lo bằng ON DELETE RESTRICT, không cần đếm trước.
 */
export interface ExerciseContentRepository {
  findByExerciseId(exerciseId: string): Promise<ExerciseContent | null>;
  /** Trả về `_id` của document để gán vào `exercises.content_ref`. */
  upsert(exerciseId: string, kind: string, content: ExerciseContent): Promise<string>;
  deleteByExerciseId(exerciseId: string): Promise<void>;
}

export const EXERCISE_REPOSITORY = Symbol('EXERCISE_REPOSITORY');
export const EXERCISE_CONTENT_REPOSITORY = Symbol('EXERCISE_CONTENT_REPOSITORY');

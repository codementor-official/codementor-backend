import { Inject, Injectable } from '@nestjs/common';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage, type Page } from '@codementor/platform';
import {
  EXERCISE_REPOSITORY,
  type ExerciseListItem,
  type ExerciseRepository,
} from '../domain/port/exercise.repository';

export interface ListExercisesQuery {
  kind?: string;
  difficulty?: string;
  status?: string;
  authorId?: string;
  updatedFrom?: string;
  updatedTo?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

@Injectable()
export class ListExercisesUseCase {
  constructor(@Inject(EXERCISE_REPOSITORY) private readonly exercises: ExerciseRepository) {}

  /**
   * `authorId = null` là kho chung và bắt buộc kèm `publishedOnly`. Tách hai tham số
   * thay vì một cờ `scope` để chỗ gọi không thể vô tình xin "mọi bài của mọi người ở
   * mọi trạng thái" — tổ hợp đó không diễn đạt được.
   */
  async execute(
    scope:
      | { authorId: string }
      | { publishedOnly: true }
      | { pendingOnly: true }
      | { adminAll: true },
    query: ListExercisesQuery,
  ): Promise<Page<ExerciseListItem>> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_LIMIT, 1), 100);
    // Kho chung theo định nghĩa chỉ có bài `published`, nên `status` ở đó vô nghĩa.
    // Hai phạm vi còn lại đọc được: `/mine` để tác giả lọc bài của mình, `/moderation`
    // để admin tìm bài đã duyệt (gỡ nhầm) hay đã từ chối (duyệt lại) — hàng chờ mà chỉ
    // thấy được `pending_review` thì mọi quyết định lỡ tay là quyết định vĩnh viễn.
    const status = 'publishedOnly' in scope ? undefined : query.status;
    // `adminAll` dùng lại chính ô `authorId`: trang quản trị xem mọi tác giả theo mặc
    // định, nhưng lọc còn về đúng một người khi `query.authorId` được truyền — cùng một
    // cột, không cần thêm ô riêng.
    const adminAuthorId = 'adminAll' in scope ? (query.authorId ?? null) : null;
    const rows = await this.exercises.list({
      authorId: 'authorId' in scope ? scope.authorId : adminAuthorId,
      publishedOnly: 'publishedOnly' in scope,
      // Xin trạng thái cụ thể thì bỏ ràng buộc `pending_review`: hai điều kiện AND với
      // nhau luôn ra rỗng, và màn hình rỗng trông hệt như "không có gì để duyệt".
      pendingOnly: 'pendingOnly' in scope && status === undefined,
      excludeDraft: 'adminAll' in scope,
      kind: query.kind,
      difficulty: query.difficulty,
      status,
      updatedFrom: query.updatedFrom ? new Date(query.updatedFrom) : undefined,
      updatedTo: query.updatedTo ? new Date(query.updatedTo) : undefined,
      q: query.q,
      limit,
      cursor: query.cursor ? (decodeCursor(query.cursor) ?? undefined) : undefined,
    });
    return toPage(rows, limit);
  }
}

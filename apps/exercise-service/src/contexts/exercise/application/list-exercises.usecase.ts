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
    scope: { authorId: string } | { publishedOnly: true },
    query: ListExercisesQuery,
  ): Promise<Page<ExerciseListItem>> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_LIMIT, 1), 100);
    const rows = await this.exercises.list({
      authorId: 'authorId' in scope ? scope.authorId : null,
      publishedOnly: !('authorId' in scope),
      kind: query.kind,
      difficulty: query.difficulty,
      status: 'authorId' in scope ? query.status : undefined,
      q: query.q,
      limit,
      cursor: query.cursor ? (decodeCursor(query.cursor) ?? undefined) : undefined,
    });
    return toPage(rows, limit);
  }
}

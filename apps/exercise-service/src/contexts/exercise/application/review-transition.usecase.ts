import { Inject, Injectable } from '@nestjs/common';
import { NotAuthorized, NotFound } from '@codementor/kernel';
import { canEditExercise, type AuthenticatedUser } from '@codementor/platform';
import { validateForSubmission } from '../domain/model/exercise-content';
import {
  EXERCISE_CONTENT_REPOSITORY,
  EXERCISE_REPOSITORY,
  type ExerciseContentRepository,
  type ExerciseRepository,
} from '../domain/port/exercise.repository';
import { toExerciseView, type ExerciseView } from './exercise-view';

/**
 * Gửi duyệt và hủy gửi duyệt. Hai chiều của cùng một cánh cửa nên ở chung một chỗ —
 * tách ra thì dễ có bên kiểm quyền khác bên kia.
 */
@Injectable()
export class ReviewTransitionUseCase {
  constructor(
    @Inject(EXERCISE_REPOSITORY) private readonly exercises: ExerciseRepository,
    @Inject(EXERCISE_CONTENT_REPOSITORY) private readonly contents: ExerciseContentRepository,
  ) {}

  async submit(user: AuthenticatedUser, id: string): Promise<ExerciseView> {
    const exercise = await this.load(user, id);

    const content = await this.contents.findByExerciseId(id);
    if (content === null) {
      const empty = validateForSubmission(exercise.kind, {});
      throw empty.error;
    }
    // Kiểm tĩnh. Chạy lời giải mẫu qua testcase cần sandbox của judge-service — Phase 5b.
    const valid = validateForSubmission(exercise.kind, content);
    if (valid.isFail) throw valid.error;

    const submitted = exercise.submit();
    if (submitted.isFail) throw submitted.error;

    await this.exercises.save(exercise);
    return toExerciseView(exercise);
  }

  async withdraw(user: AuthenticatedUser, id: string): Promise<ExerciseView> {
    const exercise = await this.load(user, id);
    const withdrawn = exercise.withdraw();
    if (withdrawn.isFail) throw withdrawn.error;

    await this.exercises.save(exercise);
    return toExerciseView(exercise);
  }

  private async load(user: AuthenticatedUser, id: string) {
    const exercise = await this.exercises.findById(id);
    if (exercise === null) throw new NotFound('Bài tập', id);
    if (!canEditExercise(user, { author_id: exercise.authorId })) {
      throw new NotAuthorized('thay đổi trạng thái bài tập này');
    }
    return exercise;
  }
}

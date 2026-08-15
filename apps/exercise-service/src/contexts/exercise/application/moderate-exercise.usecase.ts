import { Inject, Injectable } from '@nestjs/common';
import { NotAuthorized, NotFound } from '@codementor/kernel';
import type { AuthenticatedUser } from '@codementor/platform';
import { EXERCISE_REPOSITORY, type ExerciseRepository } from '../domain/port/exercise.repository';
import { toExerciseView, type ExerciseView } from './exercise-view';

export type ModerationDecision = 'approve' | 'request_changes' | 'reject' | 'archive';

/**
 * Quyết định của admin trên một bài.
 *
 * Kiểm vai trò lại ở đây dù controller đã có `@Roles('admin')`: guard bảo vệ đường HTTP,
 * còn use case là thứ mọi lối gọi khác (job, consumer Kafka) sẽ đi qua.
 */
@Injectable()
export class ModerateExerciseUseCase {
  constructor(@Inject(EXERCISE_REPOSITORY) private readonly exercises: ExerciseRepository) {}

  async execute(
    user: AuthenticatedUser,
    id: string,
    decision: ModerationDecision,
    reason: string | null,
  ): Promise<ExerciseView> {
    if (user.role !== 'admin') throw new NotAuthorized('kiểm duyệt nội dung');

    const exercise = await this.exercises.findById(id);
    if (exercise === null) throw new NotFound('Bài tập', id);

    const moderated = exercise.moderate(decision, reason);
    if (moderated.isFail) throw moderated.error;

    await this.exercises.save(exercise);
    return toExerciseView(exercise);
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { NotAuthorized, NotFound } from '@codementor/kernel';
import { canEditExercise, type AuthenticatedUser } from '@codementor/platform';
import type { ExerciseMetadataEdit } from '../domain/model/exercise';
import { EXERCISE_REPOSITORY, type ExerciseRepository } from '../domain/port/exercise.repository';
import { toExerciseView, type ExerciseView } from './exercise-view';

@Injectable()
export class UpdateExerciseUseCase {
  constructor(@Inject(EXERCISE_REPOSITORY) private readonly exercises: ExerciseRepository) {}

  async execute(
    user: AuthenticatedUser,
    id: string,
    edit: ExerciseMetadataEdit,
  ): Promise<ExerciseView> {
    const exercise = await this.exercises.findById(id);
    if (exercise === null) throw new NotFound('Bài tập', id);
    if (!canEditExercise(user, { author_id: exercise.authorId })) {
      throw new NotAuthorized('sửa bài tập này');
    }

    // Aggregate tự chặn khi đang chờ duyệt — quy tắc đó thuộc vòng đời, không thuộc use case.
    const updated = exercise.editMetadata(edit);
    if (updated.isFail) throw updated.error;

    await this.exercises.save(exercise);
    return toExerciseView(exercise);
  }
}

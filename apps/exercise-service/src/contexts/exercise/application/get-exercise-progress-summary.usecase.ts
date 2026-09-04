import { Inject, Injectable } from '@nestjs/common';
import {
  EXERCISE_REPOSITORY,
  type ExerciseProgressSummary,
  type ExerciseRepository,
} from '../domain/port/exercise.repository';

@Injectable()
export class GetExerciseProgressSummaryUseCase {
  constructor(@Inject(EXERCISE_REPOSITORY) private readonly exercises: ExerciseRepository) {}

  execute(userId: string): Promise<ExerciseProgressSummary> {
    return this.exercises.progressSummary(userId);
  }
}

import { Inject, Injectable } from '@nestjs/common';
import {
  EXERCISE_REPOSITORY,
  type ExerciseRepository,
  type ExerciseTopicSummary,
} from '../domain/port/exercise.repository';

@Injectable()
export class ListExerciseTopicsUseCase {
  constructor(@Inject(EXERCISE_REPOSITORY) private readonly exercises: ExerciseRepository) {}

  execute(userId: string): Promise<ExerciseTopicSummary[]> {
    return this.exercises.listTopics(userId);
  }
}

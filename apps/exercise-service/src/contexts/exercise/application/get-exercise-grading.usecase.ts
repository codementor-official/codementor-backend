import { Inject, Injectable } from '@nestjs/common';
import { NotFound } from '@codementor/kernel';
import {
  EXERCISE_CONTENT_REPOSITORY,
  EXERCISE_REPOSITORY,
  type ExerciseContentRepository,
  type ExerciseRepository,
} from '../domain/port/exercise.repository';

/** Internal grading snapshot. It is intentionally not part of the learner detail DTO. */
@Injectable()
export class GetExerciseGradingUseCase {
  constructor(
    @Inject(EXERCISE_REPOSITORY) private readonly exercises: ExerciseRepository,
    @Inject(EXERCISE_CONTENT_REPOSITORY) private readonly contents: ExerciseContentRepository,
  ) {}

  async execute(id: string) {
    const exercise = await this.exercises.findById(id);
    if (exercise === null || exercise.status !== 'published') {
      throw new NotFound('Bài tập', id);
    }

    const content = await this.contents.findByExerciseId(id);
    if (content === null) throw new NotFound('Nội dung bài tập', id);

    return {
      id: exercise.id,
      xpReward: exercise.xpReward,
      timeLimitMs: exercise.timeLimitMs,
      memoryLimitKb: exercise.memoryLimitKb,
      content,
    };
  }
}

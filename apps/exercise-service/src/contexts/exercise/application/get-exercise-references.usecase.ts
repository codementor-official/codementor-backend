import { Inject, Injectable } from '@nestjs/common';
import { NotFound } from '@codementor/kernel';
import { canViewExercise, type AuthenticatedUser } from '@codementor/platform';
import {
  EXERCISE_REPOSITORY,
  type ExerciseRepository,
} from '../domain/port/exercise.repository';

@Injectable()
export class GetExerciseReferencesUseCase {
  constructor(
    @Inject(EXERCISE_REPOSITORY) private readonly exercises: ExerciseRepository,
  ) {}

  async execute(user: AuthenticatedUser, id: string): Promise<{ courses: { id: string; title: string; slug: string }[] }> {
    const exercise = await this.exercises.findById(id);
    if (exercise === null) throw new NotFound('Bài tập', id);

    if (!canViewExercise(user, { author_id: exercise.authorId, visibility: exercise.visibility, status: exercise.status })) {
      throw new NotFound('Bài tập', id);
    }

    const courses = await this.exercises.findReferencingCourses(id);
    return { courses };
  }
}

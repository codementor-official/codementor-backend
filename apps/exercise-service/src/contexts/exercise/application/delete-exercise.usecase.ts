import { Inject, Injectable } from '@nestjs/common';
import { BusinessRuleViolation, NotAuthorized, NotFound } from '@codementor/kernel';
import { canEditExercise, type AuthenticatedUser } from '@codementor/platform';
import {
  EXERCISE_CONTENT_REPOSITORY,
  EXERCISE_REPOSITORY,
  type ExerciseContentRepository,
  type ExerciseRepository,
} from '../domain/port/exercise.repository';

@Injectable()
export class DeleteExerciseUseCase {
  constructor(
    @Inject(EXERCISE_REPOSITORY) private readonly exercises: ExerciseRepository,
    @Inject(EXERCISE_CONTENT_REPOSITORY) private readonly contents: ExerciseContentRepository,
  ) {}

  async execute(user: AuthenticatedUser, id: string): Promise<void> {
    const exercise = await this.exercises.findById(id);
    if (exercise === null) throw new NotFound('Bài tập', id);
    if (!canEditExercise(user, { author_id: exercise.authorId })) {
      throw new NotAuthorized('xoá bài tập này');
    }
    if (!exercise.isDeletable) {
      throw new BusinessRuleViolation(
        'Bài đã công khai không xoá được. Dùng gỡ nội dung (archived) thay vì xoá.',
      );
    }

    // Postgres trước: ON DELETE RESTRICT sẽ chặn nếu còn chương tham chiếu, và lúc đó
    // document Mongo vẫn phải còn nguyên. Xoá Mongo trước là tự tay tạo bài rỗng.
    await this.exercises.delete(id);
    await this.contents.deleteByExerciseId(id);
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { NotFound } from '@codementor/kernel';
import { canViewExercise, type AuthenticatedUser } from '@codementor/platform';
import {
  EXERCISE_CONTENT_REPOSITORY,
  EXERCISE_REPOSITORY,
  type ExerciseContentRepository,
  type ExerciseRepository,
} from '../domain/port/exercise.repository';
import { toExerciseView, toLearnerExerciseContent, type ExerciseView } from './exercise-view';

@Injectable()
export class GetExerciseUseCase {
  constructor(
    @Inject(EXERCISE_REPOSITORY) private readonly exercises: ExerciseRepository,
    @Inject(EXERCISE_CONTENT_REPOSITORY) private readonly contents: ExerciseContentRepository,
  ) {}

  async execute(user: AuthenticatedUser, id: string): Promise<ExerciseView> {
    const exercise = await this.exercises.findById(id);
    if (exercise === null) throw new NotFound('Bài tập', id);

    // 404 chứ không 403 khi không được xem: trả 403 là xác nhận bài đó tồn tại.
    // Tham số thứ ba để `false` — "học viên đang học chương tham chiếu" cần đọc bảng
    // `lessons` của learning-service, sẽ nối qua HTTP ở 4d.
    if (
      !canViewExercise(user, {
        author_id: exercise.authorId,
        visibility: exercise.visibility,
        status: exercise.status,
      })
    ) {
      throw new NotFound('Bài tập', id);
    }

    const content = await this.contents.findByExerciseId(id);
    const canSeeGradingContent = user.role === 'admin' || exercise.authorId === user.id;

    return toExerciseView(
      exercise,
      content && !canSeeGradingContent ? toLearnerExerciseContent(content) : content,
    );
  }
}

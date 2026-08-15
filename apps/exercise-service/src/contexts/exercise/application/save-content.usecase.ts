import { Inject, Injectable } from '@nestjs/common';
import { BusinessRuleViolation, NotAuthorized, NotFound } from '@codementor/kernel';
import { canEditExercise, type AuthenticatedUser } from '@codementor/platform';
import type { ExerciseContent } from '../domain/model/exercise-content';
import {
  EXERCISE_CONTENT_REPOSITORY,
  EXERCISE_REPOSITORY,
  type ExerciseContentRepository,
  type ExerciseRepository,
} from '../domain/port/exercise.repository';
import { toExerciseView, type ExerciseView } from './exercise-view';

@Injectable()
export class SaveContentUseCase {
  constructor(
    @Inject(EXERCISE_REPOSITORY) private readonly exercises: ExerciseRepository,
    @Inject(EXERCISE_CONTENT_REPOSITORY) private readonly contents: ExerciseContentRepository,
  ) {}

  async execute(
    user: AuthenticatedUser,
    id: string,
    content: ExerciseContent,
  ): Promise<ExerciseView> {
    const exercise = await this.exercises.findById(id);
    if (exercise === null) throw new NotFound('Bài tập', id);
    if (!canEditExercise(user, { author_id: exercise.authorId })) {
      throw new NotAuthorized('sửa bài tập này');
    }
    if (exercise.isLockedForReview) {
      throw new BusinessRuleViolation('Bài đang chờ duyệt. Hủy gửi duyệt trước khi sửa.');
    }

    // Document trước, `content_ref` sau. Ngược lại sẽ có khoảnh khắc hàng Postgres trỏ
    // vào một document chưa tồn tại; theo thứ tự này thì trường hợp xấu nhất chỉ là một
    // document mồ côi, mà mọi lượt đọc đều bắt đầu từ Postgres nên nó vô hại.
    const contentRef = await this.contents.upsert(id, exercise.kind, content);
    exercise.attachContent(contentRef);
    await this.exercises.save(exercise);

    return toExerciseView(exercise, content);
  }
}

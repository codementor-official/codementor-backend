import { Inject, Injectable } from '@nestjs/common';
import { AlreadyExists, NotAuthorized, NotFound } from '@codementor/kernel';
import { canEditExercise, type AuthenticatedUser } from '@codementor/platform';
import type { ExerciseMetadataEdit } from '../domain/model/exercise';
import { Slug } from '../domain/model/slug';
import { EXERCISE_REPOSITORY, type ExerciseRepository } from '../domain/port/exercise.repository';
import { toExerciseView, type ExerciseView } from './exercise-view';

@Injectable()
export class UpdateExerciseUseCase {
  constructor(@Inject(EXERCISE_REPOSITORY) private readonly exercises: ExerciseRepository) {}

  async execute(
    user: AuthenticatedUser,
    id: string,
    edit: Omit<ExerciseMetadataEdit, 'slug'> & { slug?: string },
  ): Promise<ExerciseView> {
    const exercise = await this.exercises.findById(id);
    if (exercise === null) throw new NotFound('Bài tập', id);
    if (!canEditExercise(user, { author_id: exercise.authorId })) {
      throw new NotAuthorized('sửa bài tập này');
    }

    // Slug là value object có luật riêng; dịch chuỗi sang nó trước khi vào aggregate,
    // và kiểm trùng trước để ra 409 thay vì 23505 từ driver.
    let slug: Slug | undefined;
    if (edit.slug !== undefined) {
      const parsed = Slug.create(edit.slug);
      if (parsed.isFail) throw parsed.error;
      if (parsed.value.value !== exercise.slug.value && (await this.exercises.existsBySlug(parsed.value))) {
        throw new AlreadyExists('Slug', { slug: parsed.value.value });
      }
      slug = parsed.value;
    }

    // Aggregate tự chặn khi đang chờ duyệt — quy tắc đó thuộc vòng đời, không thuộc use case.
    const updated = exercise.editMetadata({ ...edit, slug });
    if (updated.isFail) throw updated.error;

    await this.exercises.save(exercise);
    return toExerciseView(exercise);
  }
}

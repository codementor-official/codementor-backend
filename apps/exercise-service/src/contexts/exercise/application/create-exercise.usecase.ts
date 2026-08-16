import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AlreadyExists } from '@codementor/kernel';
import type { AuthenticatedUser } from '@codementor/platform';
import { Exercise, type ExerciseDifficulty, type ExerciseKind } from '../domain/model/exercise';
import { Slug } from '../domain/model/slug';
import { EXERCISE_REPOSITORY, type ExerciseRepository } from '../domain/port/exercise.repository';
import { toExerciseView, type ExerciseView } from './exercise-view';

export interface CreateExerciseInput {
  title: string;
  kind: ExerciseKind;
  difficulty: ExerciseDifficulty;
  summary?: string | null;
  slug?: string;
}

@Injectable()
export class CreateExerciseUseCase {
  constructor(@Inject(EXERCISE_REPOSITORY) private readonly exercises: ExerciseRepository) {}

  async execute(user: AuthenticatedUser, input: CreateExerciseInput): Promise<ExerciseView> {
    const slug = await this.resolveSlug(input.slug, input.title);

    const exercise = Exercise.create({
      id: randomUUID(),
      slug,
      title: input.title,
      kind: input.kind,
      difficulty: input.difficulty,
      summary: input.summary,
      authorId: user.id,
    });
    if (exercise.isFail) throw exercise.error;

    await this.exercises.save(exercise.value);
    return toExerciseView(exercise.value, null);
  }

  /**
   * Slug do người dùng đặt thì trùng là lỗi của họ — báo 409. Slug tự sinh từ tiêu đề thì
   * trùng là chuyện thường (hai bài cùng tên), nên thêm hậu tố thay vì bắt họ tự nghĩ.
   */
  private async resolveSlug(explicit: string | undefined, title: string): Promise<Slug> {
    if (explicit) {
      const parsed = Slug.create(explicit);
      if (parsed.isFail) throw parsed.error;
      if (await this.exercises.existsBySlug(parsed.value)) {
        throw new AlreadyExists('Slug', { slug: parsed.value.value });
      }
      return parsed.value;
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const suffix = attempt === 0 ? undefined : Math.random().toString(36).slice(2, 7);
      const candidate = Slug.fromTitle(title, suffix);
      if (candidate.isFail) throw candidate.error;
      if (!(await this.exercises.existsBySlug(candidate.value))) return candidate.value;
    }
    // Năm lần va nhau là bất thường; đừng lặp vô hạn, để INSERT tự nổ 23505.
    const fallback = Slug.fromTitle(title, randomUUID().slice(0, 8));
    if (fallback.isFail) throw fallback.error;
    return fallback.value;
  }
}

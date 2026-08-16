import { requireHumanId } from '@codementor/platform';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NotAuthorized, NotFound } from '@codementor/kernel';
import type { AuthenticatedUser } from '@codementor/platform';
import { Exercise } from '../domain/model/exercise';
import { Slug } from '../domain/model/slug';
import {
  EXERCISE_CONTENT_REPOSITORY,
  EXERCISE_REPOSITORY,
  type ExerciseContentRepository,
  type ExerciseRepository,
} from '../domain/port/exercise.repository';
import { toExerciseView, type ExerciseView } from './exercise-view';

@Injectable()
export class ForkExerciseUseCase {
  constructor(
    @Inject(EXERCISE_REPOSITORY) private readonly exercises: ExerciseRepository,
    @Inject(EXERCISE_CONTENT_REPOSITORY) private readonly contents: ExerciseContentRepository,
  ) {}

  async execute(user: AuthenticatedUser, sourceId: string): Promise<ExerciseView> {
    const source = await this.exercises.findById(sourceId);
    if (source === null) throw new NotFound('Bài tập', sourceId);

    // Chỉ fork được bài đã công khai. Cho fork bài nháp của người khác là đọc trộm
    // nội dung chưa phát hành.
    if (!source.isForkable) {
      throw new NotAuthorized('fork bài chưa được công khai');
    }
    if (source.authorId === user.id) {
      throw new NotAuthorized('fork bài của chính mình');
    }

    const slug = await this.freeSlug(source.title);
    const fork = Exercise.create({
      id: randomUUID(),
      slug,
      title: `${source.title} (bản sao)`,
      kind: source.kind,
      difficulty: source.difficulty,
      summary: source.summary,
      authorId: requireHumanId(user),
      forkedFromId: source.id,
    });
    if (fork.isFail) throw fork.error;

    // Sao chép cả thân bài. Bỏ bước này thì bản fork chỉ là cái vỏ rỗng — và
    // `content_ref` dùng chung document sẽ khiến sửa bản fork đổi luôn bản gốc.
    const content = await this.contents.findByExerciseId(source.id);
    if (content) {
      const contentRef = await this.contents.upsert(fork.value.id, fork.value.kind, content);
      fork.value.attachContent(contentRef);
    }

    // Trạng thái KHÔNG kế thừa: bản mới ở `draft`. Kế thừa `published` nghĩa là fork một
    // bài đã duyệt rồi sửa tuỳ ý mà vẫn đang công khai.
    const metadata = fork.value.editMetadata({
      xpReward: source.xpReward,
      estimatedMinutes: source.estimatedMinutes,
      timeLimitMs: source.timeLimitMs,
      memoryLimitKb: source.memoryLimitKb,
    });
    if (metadata.isFail) throw metadata.error;

    await this.exercises.save(fork.value);
    return toExerciseView(fork.value, content);
  }

  private async freeSlug(title: string): Promise<Slug> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = Slug.fromTitle(title, Math.random().toString(36).slice(2, 7));
      if (candidate.isFail) throw candidate.error;
      if (!(await this.exercises.existsBySlug(candidate.value))) return candidate.value;
    }
    const fallback = Slug.fromTitle(title, randomUUID().slice(0, 8));
    if (fallback.isFail) throw fallback.error;
    return fallback.value;
  }
}

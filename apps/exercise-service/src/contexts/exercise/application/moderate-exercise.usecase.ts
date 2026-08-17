import { Inject, Injectable, Logger } from '@nestjs/common';
import { EVENT_BUS, type EventBus } from '@codementor/messaging';
import { TOPICS } from '@codementor/contracts';
import { NotAuthorized, NotFound } from '@codementor/kernel';
import type { AuthenticatedUser } from '@codementor/platform';
import { EXERCISE_REPOSITORY, type ExerciseRepository } from '../domain/port/exercise.repository';
import { toExerciseView, type ExerciseView } from './exercise-view';

export type ModerationDecision = 'approve' | 'request_changes' | 'reject' | 'archive';

/**
 * Quyết định của admin trên một bài.
 *
 * Kiểm vai trò lại ở đây dù controller đã có `@Roles('admin')`: guard bảo vệ đường HTTP,
 * còn use case là thứ mọi lối gọi khác (job, consumer Kafka) sẽ đi qua.
 */
@Injectable()
export class ModerateExerciseUseCase {
  private readonly logger = new Logger(ModerateExerciseUseCase.name);

  constructor(
    @Inject(EXERCISE_REPOSITORY) private readonly exercises: ExerciseRepository,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  async execute(
    user: AuthenticatedUser,
    id: string,
    decision: ModerationDecision,
    reason: string | null,
  ): Promise<ExerciseView> {
    if (user.role !== 'admin') throw new NotAuthorized('kiểm duyệt nội dung');

    const exercise = await this.exercises.findById(id);
    if (exercise === null) throw new NotFound('Bài tập', id);

    const moderated = exercise.moderate(decision, reason);
    if (moderated.isFail) throw moderated.error;

    await this.exercises.save(exercise);

    // Chỉ báo khi bài thực sự mở ra cho người học, và chỉ với bài công khai: bài thuộc
    // một nhóm học tập không phải "bài luyện tập mới của hệ thống", nên broadcast toàn
    // hệ thống về nó vừa gây nhiễu vừa lộ nội dung riêng của nhóm.
    if (decision === 'approve' && exercise.visibility === 'public') {
      try {
        await this.eventBus.publish(TOPICS.EXERCISE_PUBLISHED, {
          exerciseId: id,
          visibility: exercise.visibility,
          title: exercise.title,
          slug: exercise.slug.value,
        });
      } catch (error) {
        this.logger.error(
          `không phát được ${TOPICS.EXERCISE_PUBLISHED} cho ${id}`,
          error as Error,
        );
      }
    }
    return toExerciseView(exercise);
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { EVENT_BUS, type EventBus } from '@codementor/messaging';
import { TOPICS } from '@codementor/contracts';
import { NotAuthorized, NotFound } from '@codementor/kernel';
import { ContentAuthorLookup, type AuthenticatedUser } from '@codementor/platform';
import type { Exercise } from '../domain/model/exercise';
import { EXERCISE_REPOSITORY, type ExerciseRepository } from '../domain/port/exercise.repository';
import { toExerciseView, type ExerciseView } from './exercise-view';

export type ModerationDecision =
  | 'approve'
  | 'request_changes'
  | 'reject'
  | 'archive'
  | 'restore'
  /** Đường lùi cho một quyết định vừa lỡ tay — xem `Course.moderate` bên learning-service. */
  | 'revert';

type NotifiableDecision = ModerationDecision | 'deny_removal';

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
    private readonly authors: ContentAuthorLookup,
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

    // Người nhận khác hẳn `EXERCISE_PUBLISHED` ở trên: cái kia nói với người học "có bài
    // mới", cái này nói riêng với tác giả rằng bài của họ vừa được quyết — kể cả khi bài
    // bị trả lại, và kể cả bài của một nhóm học tập vốn không broadcast cho ai.
    // `restore` và `revert` không sinh thông báo nào, nhưng VẪN phát sự kiện: đó là nguồn
    // dữ liệu duy nhất của nhật ký kiểm toán. Việc lọc nằm ở `fromContentModerated`.
    await this.notifyAuthor(exercise, decision, reason, user);
    return toExerciseView(exercise);
  }

  /** Admin từ chối yêu cầu xin gỡ của tác giả — bài vẫn giữ nguyên `published`. */
  async denyRemoval(user: AuthenticatedUser, id: string): Promise<ExerciseView> {
    if (user.role !== 'admin') throw new NotAuthorized('kiểm duyệt nội dung');

    const exercise = await this.exercises.findById(id);
    if (exercise === null) throw new NotFound('Bài tập', id);

    const denied = exercise.denyRemoval();
    if (denied.isFail) throw denied.error;

    await this.exercises.save(exercise);
    await this.notifyAuthor(exercise, 'deny_removal', null, user);
    return toExerciseView(exercise);
  }

  private async notifyAuthor(
    exercise: Exercise,
    decision: NotifiableDecision,
    reason: string | null,
    moderator: { displayName: string; externalId: string },
  ): Promise<void> {
    const author = await this.authors.find(exercise.authorId);
    if (!author?.externalId) return;
    try {
      await this.eventBus.publish(TOPICS.CONTENT_MODERATED, {
        kind: 'EXERCISE',
        contentId: exercise.id,
        slug: exercise.slug.value,
        title: exercise.title,
        decision,
        reason,
        authorExternalId: author.externalId,
        moderatorName: moderator.displayName,
        moderatorExternalId: moderator.externalId,
      });
    } catch (error) {
      this.logger.error(
        `không phát được ${TOPICS.CONTENT_MODERATED} cho ${exercise.id}`,
        error as Error,
      );
    }
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { EVENT_BUS, type EventBus } from '@codementor/messaging';
import { TOPICS } from '@codementor/contracts';
import { NotAuthorized, NotFound } from '@codementor/kernel';
import { canEditExercise, type AuthenticatedUser } from '@codementor/platform';
import { validateForSubmission } from '../domain/model/exercise-content';
import {
  EXERCISE_CONTENT_REPOSITORY,
  EXERCISE_REPOSITORY,
  type ExerciseContentRepository,
  type ExerciseRepository,
} from '../domain/port/exercise.repository';
import { toExerciseView, type ExerciseView } from './exercise-view';

/**
 * Gửi duyệt và hủy gửi duyệt. Hai chiều của cùng một cánh cửa nên ở chung một chỗ —
 * tách ra thì dễ có bên kiểm quyền khác bên kia.
 */
@Injectable()
export class ReviewTransitionUseCase {
  private readonly logger = new Logger(ReviewTransitionUseCase.name);

  constructor(
    @Inject(EXERCISE_REPOSITORY) private readonly exercises: ExerciseRepository,
    @Inject(EXERCISE_CONTENT_REPOSITORY) private readonly contents: ExerciseContentRepository,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  async submit(user: AuthenticatedUser, id: string): Promise<ExerciseView> {
    const exercise = await this.load(user, id);

    const content = await this.contents.findByExerciseId(id);
    if (content === null) {
      const empty = validateForSubmission(exercise.kind, {});
      throw empty.error;
    }
    // Kiểm tĩnh. Chạy lời giải mẫu qua testcase cần sandbox của judge-service — Phase 5b.
    const valid = validateForSubmission(exercise.kind, content);
    if (valid.isFail) throw valid.error;

    const submitted = exercise.submit();
    if (submitted.isFail) throw submitted.error;

    await this.exercises.save(exercise);
    // Gửi cho ADMIN, không phải người học — bài vẫn đang là bản nháp. Kafka chết chỉ ghi
    // log: bài đã `pending_review` trong DB rồi, báo lỗi lên đây là nói dối người gửi.
    try {
      await this.eventBus.publish(TOPICS.CONTENT_REVIEW_REQUESTED, {
        kind: 'EXERCISE',
        contentId: exercise.id,
        slug: exercise.slug.value,
        title: exercise.title,
        authorName: user.displayName,
      });
    } catch (error) {
      this.logger.error(
        `không phát được ${TOPICS.CONTENT_REVIEW_REQUESTED} cho ${exercise.id}`,
        error as Error,
      );
    }
    return toExerciseView(exercise);
  }

  async withdraw(user: AuthenticatedUser, id: string): Promise<ExerciseView> {
    const exercise = await this.load(user, id);
    const withdrawn = exercise.withdraw();
    if (withdrawn.isFail) throw withdrawn.error;

    await this.exercises.save(exercise);
    return toExerciseView(exercise);
  }

  /**
   * Tác giả XIN gỡ bài đang công khai của mình — không tự gỡ được nữa, chỉ ghi lại
   * nguyện vọng kèm lý do bắt buộc. Bài vẫn `published` cho tới khi admin quyết
   * (`ModerateExerciseUseCase.execute('archive', ...)` để duyệt, `denyRemoval` để từ chối).
   */
  async requestRemoval(user: AuthenticatedUser, id: string, reason: string): Promise<ExerciseView> {
    const exercise = await this.load(user, id);
    const requested = exercise.requestRemoval(reason);
    if (requested.isFail) throw requested.error;

    await this.exercises.save(exercise);
    // Người nhận là ADMIN — xem chú thích đầy đủ ở `CourseUseCases.requestRemoval`.
    try {
      await this.eventBus.publish(TOPICS.CONTENT_REMOVAL_REQUESTED, {
        kind: 'EXERCISE',
        contentId: exercise.id,
        slug: exercise.slug.value,
        title: exercise.title,
        reason: reason.trim(),
        authorName: user.displayName,
      });
    } catch (error) {
      this.logger.error(
        `không phát được ${TOPICS.CONTENT_REMOVAL_REQUESTED} cho ${exercise.id}`,
        error as Error,
      );
    }
    return toExerciseView(exercise);
  }

  /** Tác giả tự khôi phục bài đã gỡ của mình — về draft, đi lại vòng duyệt. */
  async restoreMine(user: AuthenticatedUser, id: string): Promise<ExerciseView> {
    const exercise = await this.load(user, id);
    const restored = exercise.moderate('restore', null);
    if (restored.isFail) throw restored.error;

    await this.exercises.save(exercise);
    return toExerciseView(exercise);
  }

  private async load(user: AuthenticatedUser, id: string) {
    const exercise = await this.exercises.findById(id);
    if (exercise === null) throw new NotFound('Bài tập', id);
    if (!canEditExercise(user, { author_id: exercise.authorId })) {
      throw new NotAuthorized('thay đổi trạng thái bài tập này');
    }
    return exercise;
  }
}

import type { Exercise } from '../domain/model/exercise';
import type { ExerciseContent } from '../domain/model/exercise-content';

/**
 * Nội dung an toàn để gửi xuống trình duyệt học viên.
 *
 * Hidden test, lời giải mẫu và custom checker là dữ liệu chấm bài. Chúng chỉ được đọc
 * bởi tác giả/admin hoặc submission-service, không bao giờ là một phần của learner DTO.
 */
export type LearnerExerciseContent = Omit<
  ExerciseContent,
  'testCases' | 'languages' | 'evaluation'
> & {
  testCases?: NonNullable<ExerciseContent['testCases']>;
  languages?: Array<Omit<NonNullable<ExerciseContent['languages']>[number], 'referenceSolution'>>;
  evaluation?: Omit<NonNullable<ExerciseContent['evaluation']>, 'customCheckerCode'>;
};

/** Hình chiếu phẳng trả ra HTTP. Aggregate không rò rỉ qua tầng presentation. */
export interface ExerciseView {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  kind: string;
  difficulty: string;
  status: string;
  visibility: string;
  xpReward: number;
  estimatedMinutes: number | null;
  timeLimitMs: number;
  memoryLimitKb: number;
  authorId: string | null;
  /** Id chủ đề; tên lấy từ `GET /tags` bên core-service, không lặp lại ở đây. */
  tagIds: string[];
  forkedFromId: string | null;
  rejectionReason: string | null;
  removalRequested: boolean;
  publishedAt: string | null;
  updatedAt: string;
  /** Chỉ có ở endpoint chi tiết; danh sách không kéo theo thân bài. */
  content?: ExerciseContent | LearnerExerciseContent | null;
}

export function toExerciseView(exercise: Exercise, content?: ExerciseContent | null): ExerciseView {
  return {
    id: exercise.id,
    slug: exercise.slug.value,
    title: exercise.title,
    summary: exercise.summary,
    kind: exercise.kind,
    difficulty: exercise.difficulty,
    status: exercise.status,
    visibility: exercise.visibility,
    xpReward: exercise.xpReward,
    estimatedMinutes: exercise.estimatedMinutes,
    timeLimitMs: exercise.timeLimitMs,
    memoryLimitKb: exercise.memoryLimitKb,
    authorId: exercise.authorId,
    tagIds: exercise.tagIds,
    forkedFromId: exercise.forkedFromId,
    rejectionReason: exercise.rejectionReason,
    removalRequested: exercise.removalRequested,
    publishedAt: exercise.publishedAt?.toISOString() ?? null,
    updatedAt: exercise.updatedAt.toISOString(),
    ...(content !== undefined ? { content } : {}),
  };
}

/** Tạo bản sao để không mutate document Mongo đang được repository trả về. */
export function toLearnerExerciseContent(content: ExerciseContent): LearnerExerciseContent {
  const { testCases, languages, evaluation, ...safe } = content;

  return {
    ...safe,
    ...(testCases
      ? {
          testCases: testCases
            .filter((testCase) => testCase.visibility === 'public')
            .map((testCase) => ({ ...testCase })),
        }
      : {}),
    ...(languages
      ? {
          languages: languages.map(({ referenceSolution: _referenceSolution, ...language }) => ({
            ...language,
          })),
        }
      : {}),
    ...(evaluation
      ? {
          evaluation: {
            checker: evaluation.checker,
            floatTolerance: evaluation.floatTolerance,
            stopOnFirstFailure: evaluation.stopOnFirstFailure,
          },
        }
      : {}),
  };
}

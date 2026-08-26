import type { Exercise } from '../domain/model/exercise';
import type { ExerciseContent } from '../domain/model/exercise-content';

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
  content?: ExerciseContent | null;
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

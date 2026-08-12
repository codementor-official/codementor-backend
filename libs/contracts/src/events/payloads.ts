import type { TOPICS } from './topics';

/* ---------------------------------------------------------------- Identity */

export interface UserProvisionedV1 {
  userId: string;
  externalId: string;
  email: string;
  displayName: string;
}

/* ---------------------------------------------------------------- Document */

export interface DocumentUploadedV1 {
  documentId: string;
  groupId: string;
  uploaderId: string;
  docType: string;
  storageKey: string | null;
  url: string | null;
}

export interface DocumentAnalyzeV1 {
  documentId: string;
  storageKey: string | null;
  url: string | null;
  docType: string;
}

export interface DocumentAnalyzedV1 {
  documentId: string;
  verdict: 'valid' | 'warning' | 'invalid';
  findings: string[];
  model: string;
}

export interface DocumentModeratedV1 {
  documentId: string;
  groupId: string;
  status: 'published' | 'changes' | 'rejected' | 'hidden';
  moderatedBy: string;
}

/* ---------------------------------------------------------------- Exercise */

export interface ExerciseGenerateV1 {
  requestId: string;
  requestedBy: string;
  /** null = sinh cho catalog chung; có giá trị = sinh cho một nhóm. */
  groupId: string | null;
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  language: string;
}

export interface ExerciseGeneratedV1 {
  requestId: string;
  /** Chỉ là BẢN NHÁP — người soạn phải xem và xuất bản thủ công. */
  draft: {
    title: string;
    statement: string;
    constraints: string[];
    testCases: { input: string; expected: string; visibility: 'public' | 'hidden' }[];
  };
  model: string;
}

export interface ExercisePublishedV1 {
  exerciseId: string;
  visibility: 'public' | 'group';
}

/* ------------------------------------------------------- Submission / Judge */

export interface SubmissionCreatedV1 {
  submissionId: string;
  userId: string;
  exerciseId: string;
  assignmentId: string | null;
  language: string;
  attemptNumber: number;
}

/**
 * Judge nhận ĐỦ dữ liệu trong payload và không gọi HTTP sang service nào —
 * nhờ vậy nó chạy được kể cả khi các service khác đang sập.
 */
export interface JudgeRunV1 {
  submissionId: string;
  language: string;
  sourceCode: string;
  timeLimitMs: number;
  memoryLimitKb: number;
  testCases: { order: number; input: string; expected: string; weight: number }[];
}

export interface JudgeStartedV1 {
  submissionId: string;
  worker: string;
}

export interface JudgeCompletedV1 {
  submissionId: string;
  verdict:
    | 'accepted'
    | 'wrong_answer'
    | 'compile_error'
    | 'runtime_error'
    | 'timeout'
    | 'memory_exceeded';
  score: number;
  passedTests: number;
  totalTests: number;
  runtimeMs: number;
  memoryKb: number;
  /** _id của tài liệu chi tiết trong MongoDB submission_run_details. */
  runDetailRef: string | null;
}

/**
 * Phát bởi **submission-service** SAU KHI đã ghi verdict — không phải bởi judge.
 *
 * Judge chỉ biết chạy code; nó không biết gì về tiến độ luyện tập hay XP. Nếu để judge
 * phát sự kiện này thì hai service cùng công bố trạng thái nghiệp vụ của bài nộp.
 */
export interface SubmissionEvaluatedV1 {
  submissionId: string;
  userId: string;
  exerciseId: string;
  assignmentId: string | null;
  accepted: boolean;
  score: number;
  /** XP thưởng khi lần ĐẦU giải được; 0 nếu người này đã giải bài đó trước đó. */
  xpAwarded: number;
}

/* ---------------------------------------------------------------- Learning */

export interface LessonCompletedV1 {
  userId: string;
  lessonId: string;
  courseId: string;
  completedAt: string;
}

export interface CourseCompletedV1 {
  userId: string;
  courseId: string;
  roadmapId: string | null;
}

/* --------------------------------------------------------------- Workspace */

export interface AssignmentCreatedV1 {
  groupId: string;
  groupExerciseId: string;
  exerciseId: string;
  memberIds: string[];
  dueAt: string | null;
}

export interface AssignmentReviewedV1 {
  groupId: string;
  assignmentId: string;
  memberId: string;
  reviewStatus: 'approved' | 'needsfix';
  reviewedBy: string;
}

/* ------------------------------------------------------------------ Mapping */

/**
 * Ánh xạ topic → kiểu payload. Producer và consumer đều đi qua map này nên không thể
 * ghép sai cặp topic/payload — lỗi sẽ hiện lúc biên dịch thay vì lúc chạy.
 */
export interface TopicPayloadMap {
  [TOPICS.USER_PROVISIONED]: UserProvisionedV1;

  [TOPICS.DOCUMENT_UPLOADED]: DocumentUploadedV1;
  [TOPICS.DOCUMENT_ANALYZE]: DocumentAnalyzeV1;
  [TOPICS.DOCUMENT_ANALYZED]: DocumentAnalyzedV1;
  [TOPICS.DOCUMENT_MODERATED]: DocumentModeratedV1;

  [TOPICS.EXERCISE_GENERATE]: ExerciseGenerateV1;
  [TOPICS.EXERCISE_GENERATED]: ExerciseGeneratedV1;
  [TOPICS.EXERCISE_PUBLISHED]: ExercisePublishedV1;

  [TOPICS.SUBMISSION_CREATED]: SubmissionCreatedV1;
  [TOPICS.JUDGE_RUN]: JudgeRunV1;
  [TOPICS.JUDGE_STARTED]: JudgeStartedV1;
  [TOPICS.JUDGE_COMPLETED]: JudgeCompletedV1;
  [TOPICS.SUBMISSION_EVALUATED]: SubmissionEvaluatedV1;

  [TOPICS.LESSON_COMPLETED]: LessonCompletedV1;
  [TOPICS.COURSE_COMPLETED]: CourseCompletedV1;

  [TOPICS.ASSIGNMENT_CREATED]: AssignmentCreatedV1;
  [TOPICS.ASSIGNMENT_REVIEWED]: AssignmentReviewedV1;
}

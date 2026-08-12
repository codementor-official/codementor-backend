/**
 * Registry topic. Cấm hard-code chuỗi tên topic ở bất kỳ đâu khác — gõ sai một ký tự
 * sẽ tạo topic mới một cách im lặng thay vì báo lỗi.
 *
 * Quy ước đặt tên:
 *   cmd.*  yêu cầu LÀM một việc  → đúng MỘT consumer group xử lý
 *   evt.*  sự việc ĐÃ xảy ra     → nhiều consumer group tuỳ ý lắng nghe
 */
export const TOPICS = {
  // ---- Identity ----
  USER_PROVISIONED: 'evt.user.provisioned.v1',

  // ---- Document ----
  DOCUMENT_UPLOADED: 'evt.document.uploaded.v1',
  DOCUMENT_ANALYZE: 'cmd.document.analyze.v1',
  DOCUMENT_ANALYZED: 'evt.document.analyzed.v1',
  DOCUMENT_MODERATED: 'evt.document.moderated.v1',

  // ---- Exercise ----
  EXERCISE_GENERATE: 'cmd.exercise.generate.v1',
  EXERCISE_GENERATED: 'evt.exercise.generated.v1',
  EXERCISE_PUBLISHED: 'evt.exercise.published.v1',

  // ---- Submission / Judge ----
  SUBMISSION_CREATED: 'evt.submission.created.v1',
  JUDGE_RUN: 'cmd.judge.run.v1',
  JUDGE_STARTED: 'evt.judge.started.v1',
  JUDGE_COMPLETED: 'evt.judge.completed.v1',
  SUBMISSION_EVALUATED: 'evt.submission.evaluated.v1',

  // ---- Learning ----
  LESSON_COMPLETED: 'evt.lesson.completed.v1',
  COURSE_COMPLETED: 'evt.course.completed.v1',

  // ---- Workspace ----
  ASSIGNMENT_CREATED: 'evt.assignment.created.v1',
  ASSIGNMENT_REVIEWED: 'evt.assignment.reviewed.v1',
} as const;

export type TopicName = (typeof TOPICS)[keyof typeof TOPICS];

/**
 * Trường dùng làm partition key cho từng topic.
 *
 * Kafka chỉ đảm bảo thứ tự TRONG một partition. Chọn sai key thì hệ thống chạy đúng khi
 * có 1 partition và sai khi scale lên nhiều partition — lỗi rất khó truy vì không tái hiện
 * được ở môi trường dev.
 */
export const PARTITION_KEY: Record<TopicName, string> = {
  [TOPICS.USER_PROVISIONED]: 'userId',

  [TOPICS.DOCUMENT_UPLOADED]: 'documentId',
  [TOPICS.DOCUMENT_ANALYZE]: 'documentId',
  [TOPICS.DOCUMENT_ANALYZED]: 'documentId',
  [TOPICS.DOCUMENT_MODERATED]: 'documentId',

  [TOPICS.EXERCISE_GENERATE]: 'requestId',
  [TOPICS.EXERCISE_GENERATED]: 'requestId',
  [TOPICS.EXERCISE_PUBLISHED]: 'exerciseId',

  // Mọi bước của một bài nộp phải giữ đúng thứ tự: created -> run -> started -> completed.
  [TOPICS.SUBMISSION_CREATED]: 'submissionId',
  [TOPICS.JUDGE_RUN]: 'submissionId',
  [TOPICS.JUDGE_STARTED]: 'submissionId',
  [TOPICS.JUDGE_COMPLETED]: 'submissionId',

  // Đổi sang userId: XP và streak của một người phải được cộng tuần tự.
  [TOPICS.SUBMISSION_EVALUATED]: 'userId',
  [TOPICS.LESSON_COMPLETED]: 'userId',
  [TOPICS.COURSE_COMPLETED]: 'userId',

  [TOPICS.ASSIGNMENT_CREATED]: 'groupId',
  [TOPICS.ASSIGNMENT_REVIEWED]: 'groupId',
};

/** Topic dạng command — chỉ được có đúng một consumer group. Dùng để kiểm tra lúc đăng ký. */
export const COMMAND_TOPICS: readonly TopicName[] = [
  TOPICS.DOCUMENT_ANALYZE,
  TOPICS.EXERCISE_GENERATE,
  TOPICS.JUDGE_RUN,
];

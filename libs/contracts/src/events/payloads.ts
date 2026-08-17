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

/**
 * `title` và `slug` đi kèm payload thay vì để consumer gọi ngược lại exercise-service.
 *
 * Consumer chính là notification-service, và nó cần đúng hai trường này để dựng câu
 * thông báo. Gọi HTTP ngược lại sẽ khiến việc tạo thông báo hỏng mỗi khi service nguồn
 * sập — đúng lúc hệ thống đang yếu nhất. Đây cũng là lý do payload là ẢNH CHỤP: đổi tên
 * bài sau đó không làm đổi thông báo đã gửi, và như vậy mới đúng.
 */
export interface ExercisePublishedV1 {
  exerciseId: string;
  visibility: 'public' | 'group';
  title: string;
  slug: string | null;
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
 * Cách chấm một bài ở chế độ chữ ký hàm: học viên chỉ viết thân hàm, judge sinh driver bao
 * quanh và so sánh **giá trị trả về**.
 *
 * Đây là ảnh chụp, không phải tham chiếu: judge không đọc DB, nên đổi đề sau khi phát lệnh
 * không làm đổi cách bài nộp này được chấm.
 */
/** Nút Type IR — độc lập ngôn ngữ. `{ kind: "list", of: { kind: "float" } }`. */
export interface TypeIRV1 {
  kind: string;
  of?: TypeIRV1;
  key?: TypeIRV1;
  value?: TypeIRV1;
}

export interface JudgeSpecV1 {
  /** snake_case; judge tự đổi sang camelCase cho JS/Java/Go/PHP. */
  functionName: string;
  /**
   * Bắt buộc với ngôn ngữ kiểu tĩnh (Java, Go, C, C++): driver khai báo biến và gọi hàm theo
   * đúng kiểu này. Python và JavaScript bỏ qua.
   */
  parameters?: { name: string; type: TypeIRV1 }[];
  returnType?: TypeIRV1;
  /** `exact` mặc định. `float` so sánh có sai số, `unordered` so như đa tập. */
  judgeMode?: 'exact' | 'float' | 'unordered';
  judgeConfig?: { absEps?: number; relEps?: number };
  /** Tăng mỗi khi đổi chữ ký / test case; ghi lại để biết bài nộp cũ chấm theo bộ nào. */
  judgeVersion?: number;
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
  /**
   * Vắng mặt = chế độ stdin/stdout cũ. Judge rẽ nhánh theo trường này chứ không theo một cột
   * `ioMode` riêng, để bài cũ chạy nguyên vẹn mà không phải migrate gì.
   */
  spec?: JudgeSpecV1;
  testCases: {
    order: number;
    /** stdin/stdout mode. */
    input?: string;
    /** function mode: tham số theo VỊ TRÍ, khớp thứ tự `signature.parameters`. */
    args?: unknown[];
    /** Chuỗi ở mode cũ; giá trị JSON bất kỳ ở function mode. */
    expected?: unknown;
    weight: number;
  }[];
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

/** Phát khi admin duyệt (`moderate('approve')`), tức lúc khoá học thực sự mở cho người học. */
export interface CoursePublishedV1 {
  courseId: string;
  slug: string;
  title: string;
  /** Tên hiển thị của giảng viên, đã phân giải sẵn — xem ghi chú ở `ExercisePublishedV1`. */
  lecturerName: string | null;
}

export interface RoadmapPublishedV1 {
  roadmapId: string;
  slug: string;
  title: string;
}

/* ------------------------------------------------------------- Notification */

/**
 * Thông báo do admin soạn tay. Khác mọi event còn lại ở chỗ nội dung là do người viết,
 * không phải do notification-service dựng từ dữ liệu nghiệp vụ.
 */
export interface AdminAnnouncementCreatedV1 {
  announcementId: string;
  title: string;
  message: string;
}

/**
 * Một thông báo đã nằm trong MongoDB. realtime-service chỉ việc đẩy xuống client.
 *
 * Payload mang ĐỦ nội dung để hiển thị: realtime-service không sở hữu bảng nào và không
 * được phép đọc Mongo của notification-service, nên nếu thiếu trường nào ở đây thì
 * client sẽ nhận một thông báo rỗng.
 */
export interface NotificationCreatedV1 {
  notificationId: string;
  type: string;
  title: string;
  message: string;
  audienceType: 'ALL';
  referenceType: string | null;
  referenceId: string | null;
  actionLabel: string | null;
  actionUrl: string | null;
  createdAt: string;
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
  [TOPICS.COURSE_PUBLISHED]: CoursePublishedV1;
  [TOPICS.ROADMAP_PUBLISHED]: RoadmapPublishedV1;

  [TOPICS.ADMIN_ANNOUNCEMENT_CREATED]: AdminAnnouncementCreatedV1;
  [TOPICS.NOTIFICATION_CREATED]: NotificationCreatedV1;

  [TOPICS.ASSIGNMENT_CREATED]: AssignmentCreatedV1;
  [TOPICS.ASSIGNMENT_REVIEWED]: AssignmentReviewedV1;
}

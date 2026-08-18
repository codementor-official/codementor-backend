import type { AudienceType } from './audience';
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

/**
 * Judge vừa chấm ĐẠT một bài code mà người học mở từ trong một khóa học.
 *
 * Phát từ đường HTTP `POST /judge/run`, và CHỈ khi request mang theo `context` — luyện tập
 * tự do ở /practice không có khóa học nào để ghi tiến độ, nên không phát gì cả.
 *
 * Đây là `evt.*` chứ không phải `cmd.*` một cách có chủ đích: judge kể lại việc đã xảy ra,
 * còn "việc này có tính là hoàn thành bài học không" là quyết định của learning-service —
 * nó mới là nơi biết bài học có thuộc khóa đó không và người học đã ghi danh chưa. Judge
 * không được phép ra lệnh ghi tiến độ.
 */
export interface ExerciseSolvedV1 {
  /**
   * `sub` của Keycloak, KHÔNG phải `users.id`.
   *
   * Judge chỉ có claim trong token; ánh xạ sang khoá chính của ta nằm ở `users.external_id`
   * và là việc của consumer. Đặt tên đúng thứ nó chứa để không ai vô tình dùng nó làm khoá
   * ngoại — một `userId` sai loại sẽ lặng lẽ không khớp hàng nào thay vì báo lỗi.
   */
  externalUserId: string;
  exerciseId: string;
  courseId: string;
  lessonId: string;
  score: number;
  solvedAt: string;
}

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

/** Phát khi admin bấm đăng, và chỉ ở lần đầu tiên. */
export interface ArticlePublishedV1 {
  articleId: string;
  slug: string;
  title: string;
  /** Tóm tắt do người viết soạn; bắt buộc phải có mới đăng được bài. */
  excerpt: string | null;
}


/* -------------------------------------------------------------- Kiểm duyệt */

/**
 * Bốn loại nội dung đi qua cùng một máy trạng thái duyệt. Chuỗi giống `ReferenceType`
 * bên notification-service ("POST" chứ không phải "ARTICLE" — từ vựng hướng ra ngoài).
 */
export type ReviewableKind = 'COURSE' | 'ROADMAP' | 'EXERCISE' | 'POST';

/**
 * Giảng viên bấm "Gửi duyệt".
 *
 * `authorName` đi kèm payload thay vì để consumer gọi ngược lại — cùng lý do đã ghi ở
 * `ExercisePublishedV1`: thông báo là ảnh chụp, và dựng nó không được phụ thuộc vào việc
 * service nguồn còn sống hay không.
 */
export interface ContentReviewRequestedV1 {
  kind: ReviewableKind;
  contentId: string;
  slug: string | null;
  title: string;
  authorName: string | null;
}

/**
 * Admin đã quyết. Gửi riêng cho tác giả, nên payload mang `authorExternalId`.
 *
 * `sub` của Keycloak chứ không phải `users.id`: realtime-service chỉ biết danh tính từ
 * token bắt tay và cố tình không đọc bảng `users` của service khác. Dùng `users.id` ở đây
 * đồng nghĩa thông báo vẫn lưu đúng nhưng không bao giờ đẩy được xuống máy tác giả.
 */
export interface ContentModeratedV1 {
  kind: ReviewableKind;
  contentId: string;
  slug: string | null;
  title: string;
  decision: 'approve' | 'request_changes' | 'reject' | 'archive';
  /** Bắt buộc có khi từ chối hoặc yêu cầu sửa — đó là câu tác giả sẽ đọc. */
  reason: string | null;
  authorExternalId: string;
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
  /**
   * Ai được nhận. `ALL` là mọi người đã đăng nhập; `ROLE`/`USER` thì `audienceKey` mang
   * tên vai trò hoặc `sub` Keycloak của đúng một người.
   *
   * realtime-service lấy tên phòng từ đúng hai trường này (`audienceRoom`) — nó không có
   * cách nào khác để biết đẩy cho ai, vì nó không đọc Mongo của notification-service.
   */
  audienceType: AudienceType;
  audienceKey: string | null;
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
  [TOPICS.EXERCISE_SOLVED]: ExerciseSolvedV1;

  [TOPICS.LESSON_COMPLETED]: LessonCompletedV1;
  [TOPICS.COURSE_COMPLETED]: CourseCompletedV1;
  [TOPICS.COURSE_PUBLISHED]: CoursePublishedV1;
  [TOPICS.ROADMAP_PUBLISHED]: RoadmapPublishedV1;
  [TOPICS.ARTICLE_PUBLISHED]: ArticlePublishedV1;

  [TOPICS.CONTENT_REVIEW_REQUESTED]: ContentReviewRequestedV1;
  [TOPICS.CONTENT_MODERATED]: ContentModeratedV1;

  [TOPICS.ADMIN_ANNOUNCEMENT_CREATED]: AdminAnnouncementCreatedV1;
  [TOPICS.NOTIFICATION_CREATED]: NotificationCreatedV1;

  [TOPICS.ASSIGNMENT_CREATED]: AssignmentCreatedV1;
  [TOPICS.ASSIGNMENT_REVIEWED]: AssignmentReviewedV1;
}

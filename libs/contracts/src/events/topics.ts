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
  EXERCISE_SOLVED: 'evt.exercise.solved.v1',

  // ---- Learning ----
  LESSON_COMPLETED: 'evt.lesson.completed.v1',
  COURSE_COMPLETED: 'evt.course.completed.v1',
  /**
   * Khoá học/lộ trình đã CÔNG KHAI, không phải vừa được tạo.
   *
   * Cả hai đều là bản nháp cho tới khi admin duyệt (`moderate('approve')`). Báo lúc tạo
   * nghĩa là gửi thông báo về thứ người học mở ra sẽ nhận 404.
   */
  COURSE_PUBLISHED: 'evt.course.published.v1',
  ROADMAP_PUBLISHED: 'evt.roadmap.published.v1',
  /**
   * Bài viết biên tập — thứ mà yêu cầu gọi là "post". Hệ thống đã gọi nó là `article`
   * từ bảng `articles` tới route `/articles/[slug]` bên client, nên giữ nguyên tên đó.
   *
   * Chỉ phát ở lần công khai ĐẦU TIÊN: sửa bài đã đăng, hoặc gỡ xuống rồi đăng lại,
   * không được báo "bài viết mới" lần nữa. Xem `Article.publish()`.
   */
  ARTICLE_PUBLISHED: 'evt.article.published.v1',

  // ---- Kiểm duyệt (chung cho mọi loại nội dung) ----
  /**
   * Giảng viên vừa gửi một nội dung đi duyệt. Người nhận là ADMIN, không phải người học.
   *
   * Một topic chung cho khoá học/lộ trình/bài tập/bài viết thay vì bốn: người nhận, câu
   * chữ và hành động giống hệt nhau ở cả bốn — chỉ khác đúng một chữ trong câu. Bốn topic
   * sẽ là bốn consumer, bốn hàm dựng nội dung và bốn chỗ phải nhớ sửa.
   */
  CONTENT_REVIEW_REQUESTED: 'evt.content.review_requested.v1',
  /**
   * Tác giả xin gỡ một nội dung ĐANG CÔNG KHAI. Người nhận là ADMIN.
   *
   * Không gộp vào `CONTENT_REVIEW_REQUESTED` dù cùng người nhận và cùng chỗ bấm: hai
   * việc này ngược chiều nhau. Một cái xin đưa nội dung LÊN, cái kia xin gỡ nội dung
   * đang sống XUỐNG, và cái sau luôn kèm lý do bắt buộc mà admin phải đọc trước khi
   * quyết. Trộn chung thì admin không lọc ra được nhóm nào đang chờ mình.
   */
  CONTENT_REMOVAL_REQUESTED: 'evt.content.removal_requested.v1',
  /**
   * Admin đã ra quyết định. Người nhận là TÁC GIẢ của nội dung đó, không phải cả hệ thống.
   *
   * Tách khỏi `*_PUBLISHED`: hai sự kiện nói hai chuyện với hai nhóm người khác nhau.
   * Duyệt một khoá học vừa báo cho người học "có khoá mới" (`COURSE_PUBLISHED`) vừa báo
   * cho giảng viên "bài của bạn đã được duyệt" — gộp lại thì một trong hai nhóm nhận nhầm.
   */
  CONTENT_MODERATED: 'evt.content.moderated.v1',

  // ---- Notification ----
  /** Admin gửi thông báo toàn hệ thống. Không gắn với tài nguyên nghiệp vụ nào. */
  ADMIN_ANNOUNCEMENT_CREATED: 'evt.admin.announcement.created.v1',
  /**
   * notification-service đã lưu xong một thông báo.
   *
   * realtime-service nghe topic này để đẩy xuống client. Tách làm hai chặng vì
   * realtime-service không sở hữu bảng nào và không chứa business logic — nó chỉ là cầu
   * nối Kafka → WebSocket (docs/02-service-architecture.md §7). Nhờ vậy sau này thêm
   * kênh đẩy khác chỉ là thêm consumer, không đụng notification-service.
   */
  NOTIFICATION_CREATED: 'evt.notification.created.v1',
  REMINDER_SOURCE_CHANGED: 'evt.reminder.source-changed.v1',

  // ---- Workspace ----
  ASSIGNMENT_CREATED: 'evt.assignment.created.v1',
  ASSIGNMENT_REMINDER: 'evt.assignment.reminder.v1',
  ASSIGNMENT_REVIEWED: 'evt.assignment.reviewed.v1',
  WORKSPACE_MESSAGE_CREATED: 'evt.workspace.message-created.v1',
  WORKSPACE_JOIN_REVIEWED: 'evt.workspace.join-reviewed.v1',
  WORKSPACE_ACTIVITY: 'evt.workspace.activity.v1',
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
  // Cùng lý do: tiến độ của một người phải được ghi tuần tự, nếu không hai bài giải gần
  // nhau có thể mở khoá bài kế tiếp theo thứ tự sai. Key là id Keycloak vì judge chỉ có
  // nó — vẫn là một người một partition, đó là tất cả những gì thứ tự cần.
  [TOPICS.EXERCISE_SOLVED]: 'externalUserId',
  [TOPICS.LESSON_COMPLETED]: 'userId',
  [TOPICS.COURSE_COMPLETED]: 'userId',

  // Không phải userId: đây là sự kiện về NỘI DUNG, phát cho mọi người học. Khoá theo
  // chính tài nguyên để hai lần duyệt cùng một khoá học giữ đúng thứ tự.
  [TOPICS.COURSE_PUBLISHED]: 'courseId',
  [TOPICS.ROADMAP_PUBLISHED]: 'roadmapId',
  [TOPICS.ARTICLE_PUBLISHED]: 'articleId',
  // Khoá theo chính nội dung: hai quyết định liên tiếp trên cùng một bài phải tới đúng thứ tự.
  [TOPICS.CONTENT_REVIEW_REQUESTED]: 'contentId',
  [TOPICS.CONTENT_REMOVAL_REQUESTED]: 'contentId',
  [TOPICS.CONTENT_MODERATED]: 'contentId',
  [TOPICS.ADMIN_ANNOUNCEMENT_CREATED]: 'announcementId',
  [TOPICS.NOTIFICATION_CREATED]: 'notificationId',
  [TOPICS.REMINDER_SOURCE_CHANGED]: 'entityId',

  [TOPICS.ASSIGNMENT_CREATED]: 'groupId',
  [TOPICS.ASSIGNMENT_REMINDER]: 'groupId',
  [TOPICS.ASSIGNMENT_REVIEWED]: 'groupId',
  [TOPICS.WORKSPACE_MESSAGE_CREATED]: 'groupId',
  [TOPICS.WORKSPACE_JOIN_REVIEWED]: 'groupId',
  [TOPICS.WORKSPACE_ACTIVITY]: 'groupId',
};

/** Topic dạng command — chỉ được có đúng một consumer group. Dùng để kiểm tra lúc đăng ký. */
export const COMMAND_TOPICS: readonly TopicName[] = [
  TOPICS.DOCUMENT_ANALYZE,
  TOPICS.EXERCISE_GENERATE,
  TOPICS.JUDGE_RUN,
];

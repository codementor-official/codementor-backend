import type { InvalidInput, Result } from '@codementor/kernel';
import type {
  AdminAnnouncementCreatedV1,
  ArticlePublishedV1,
  ContentModeratedV1,
  ContentRemovalRequestedV1,
  ContentReviewRequestedV1,
  CoursePublishedV1,
  ExercisePublishedV1,
  ReviewableKind,
  RoadmapPublishedV1,
} from '@codementor/contracts';
import { NotificationContent } from '../domain/model/notification-content';
import type { ReferenceType } from '../domain/model/notification-content';

/**
 * Sự kiện nghiệp vụ → câu chữ người dùng đọc.
 *
 * Toàn bộ phần "viết lách" của hệ thống thông báo nằm trong đúng file này. Các service
 * nguồn (learning, exercise, core) chỉ phát dữ liệu thô — chúng không được biết thông
 * báo trông như thế nào, nếu không mỗi lần sửa một câu chữ lại phải deploy ba service.
 *
 * Hàm thuần, không I/O: kiểm bằng assert được mà không cần Mongo hay Kafka. Bất biến
 * (tiêu đề rỗng, nút bấm không có link…) do `NotificationContent.create` chặn, nên một
 * hàm mới viết sai sẽ trả `Result` thất bại chứ không ghi rác vào MongoDB.
 */
type Draft = Result<NotificationContent, InvalidInput>;

/** Dấu nháy kép kiểu Việt cho tên nội dung, để câu văn không bị lẫn với dấu nháy code. */
function quoted(title: string): string {
  return `“${title}”`;
}

export function fromCoursePublished(payload: CoursePublishedV1): Draft {
  // Tên giảng viên có thể chưa phân giải được (tài khoản đã xoá, hoặc khoá học do hệ
  // thống seed). Câu văn phải đọc được trong cả hai trường hợp chứ không hiện "null".
  const author = payload.lecturerName?.trim();
  const opening = author ? `Giảng viên ${author} vừa xuất bản` : 'CodeMentor vừa ra mắt';

  return NotificationContent.create({
    type: 'COURSE_PUBLISHED',
    title: '🎓 Khóa học mới vừa ra mắt!',
    message: `${opening} khóa học ${quoted(payload.title)}. Bạn có muốn bắt đầu học ngay không?`,
    referenceType: 'COURSE',
    referenceId: payload.courseId,
    actionLabel: 'Học ngay',
    // Ứng dụng chưa có trang chi tiết khoá học đứng độc lập — đường duy nhất tới một
    // khoá học hiện đi qua lộ trình chứa nó (`/paths/{slug}/courses/{slug}`), mà event
    // này không biết lộ trình nào. Trỏ về danh mục thay vì dựng một URL sẽ 404.
    // `slug` vẫn nằm trong metadata: có trang chi tiết thì đây là sửa đúng một dòng.
    actionUrl: '/courses',
    metadata: { slug: payload.slug, lecturerName: payload.lecturerName },
  });
}

export function fromExercisePublished(payload: ExercisePublishedV1): Draft {
  return NotificationContent.create({
    type: 'EXERCISE_PUBLISHED',
    title: '💻 Có bài luyện tập mới dành cho bạn!',
    message: `Hệ thống vừa cập nhật bài luyện tập ${quoted(payload.title)}. Thử sức ngay để kiểm tra kiến thức của bạn nhé!`,
    referenceType: 'EXERCISE',
    referenceId: payload.exerciseId,
    actionLabel: 'Luyện tập ngay',
    actionUrl: `/solve/${payload.exerciseId}`,
    metadata: { slug: payload.slug },
  });
}

export function fromRoadmapPublished(payload: RoadmapPublishedV1): Draft {
  return NotificationContent.create({
    type: 'ROADMAP_PUBLISHED',
    title: '🗺️ Lộ trình học tập mới đã sẵn sàng!',
    message: `CodeMentor vừa ra mắt lộ trình ${quoted(payload.title)}. Bắt đầu từng bước để tiến gần hơn tới mục tiêu của bạn.`,
    referenceType: 'ROADMAP',
    referenceId: payload.roadmapId,
    actionLabel: 'Khám phá lộ trình',
    // `/paths/[pathId]` nhận SLUG chứ không phải id — xem roadmap-card.tsx bên client.
    actionUrl: `/paths/${payload.slug}`,
    metadata: { slug: payload.slug },
  });
}

export function fromArticlePublished(payload: ArticlePublishedV1): Draft {
  // Tóm tắt là câu người viết tự chọn để mời đọc, nên dùng lại nguyên văn khi có. Không
  // có thì rơi về một câu chung — thà chung chung còn hơn hiện một đoạn trống.
  const teaser = payload.excerpt?.trim()
    ? `${payload.excerpt.trim()}`
    : 'Khám phá ngay để cập nhật thêm kiến thức mới.';

  return NotificationContent.create({
    type: 'ARTICLE_PUBLISHED',
    title: '📝 Bài viết mới vừa được đăng!',
    message: `CodeMentor vừa cập nhật bài viết ${quoted(payload.title)}. ${teaser}`,
    referenceType: 'POST',
    referenceId: payload.articleId,
    actionLabel: 'Đọc bài viết',
    // `/articles/[slug]` là route có thật bên client — khác khoá học, bài viết có trang
    // chi tiết đứng độc lập nên liên kết sâu được thẳng tới đúng bài.
    actionUrl: `/articles/${payload.slug}`,
    metadata: { slug: payload.slug },
  });
}

export function fromAdminAnnouncement(payload: AdminAnnouncementCreatedV1): Draft {
  return NotificationContent.create({
    type: 'ADMIN_ANNOUNCEMENT',
    // Khác ba loại trên: nội dung do admin gõ, service không viết hộ. Chỉ thêm đúng một
    // tiền tố để người đọc biết đây là thông báo hệ thống chứ không phải nội dung mới.
    title: `📢 ${payload.title}`,
    message: payload.message,
    // Không có gì để bấm vào: thông báo bảo trì không dẫn tới trang nào cả.
    metadata: { announcementId: payload.announcementId },
  });
}

/* ------------------------------------------------------- Kiểm duyệt nội dung */

/**
 * `ReviewableKind` trùng đúng `ReferenceType` về giá trị, nhưng hai kiểu ấy thuộc hai
 * tầng khác nhau và không được phép ép ngầm cho nhau: một ngày nào đó thêm loại nội dung
 * duyệt được mà chưa có thông báo tương ứng, bảng này sẽ báo lỗi biên dịch đúng chỗ.
 */
const REFERENCE_BY_KIND: Record<ReviewableKind, ReferenceType> = {
  COURSE: 'COURSE',
  ROADMAP: 'ROADMAP',
  EXERCISE: 'EXERCISE',
  POST: 'POST',
};

const KIND_LABEL: Record<ReviewableKind, string> = {
  COURSE: 'khoá học',
  ROADMAP: 'lộ trình',
  EXERCISE: 'bài code',
  POST: 'bài viết',
};

/** Trang danh sách bên studio giảng viên, nơi tác giả mở nội dung ra sửa. */
const LECTURER_PATH: Record<ReviewableKind, string> = {
  COURSE: '/courses',
  ROADMAP: '/roadmaps',
  EXERCISE: '/exercises',
  POST: '/articles',
};

/** Gửi cho ADMIN, không phải người học: nội dung này còn đang là bản nháp. */
export function fromContentReviewRequested(payload: ContentReviewRequestedV1): Draft {
  const author = payload.authorName?.trim();
  const who = author ? `Giảng viên ${author}` : 'Một giảng viên';

  return NotificationContent.create({
    type: 'CONTENT_REVIEW_REQUESTED',
    audienceType: 'ROLE',
    audienceKey: 'admin',
    title: '🔔 Có nội dung chờ bạn duyệt',
    message: `${who} vừa gửi ${KIND_LABEL[payload.kind]} ${quoted(payload.title)} đi duyệt.`,
    referenceType: REFERENCE_BY_KIND[payload.kind],
    referenceId: payload.contentId,
    actionLabel: 'Mở hàng chờ duyệt',
    actionUrl: '/moderation',
    metadata: { kind: payload.kind, slug: payload.slug, authorName: payload.authorName },
  });
}

/**
 * Gửi cho ADMIN. Ngược chiều với `fromContentReviewRequested`: nội dung này ĐANG công
 * khai và tác giả xin gỡ nó xuống.
 *
 * Lý do nằm ngay trong câu chứ không chỉ trong `metadata`: đó là thứ quyết định admin bấm
 * duyệt hay từ chối, và bắt họ mở nội dung ra mới đọc được lý do là bắt thêm một bước cho
 * mọi yêu cầu, kể cả những yêu cầu hiển nhiên.
 */
export function fromContentRemovalRequested(payload: ContentRemovalRequestedV1): Draft {
  const author = payload.authorName?.trim();
  const who = author ? `Giảng viên ${author}` : 'Một giảng viên';

  return NotificationContent.create({
    type: 'CONTENT_REMOVAL_REQUESTED',
    audienceType: 'ROLE',
    audienceKey: 'admin',
    title: '🗑️ Có yêu cầu gỡ nội dung đang công khai',
    message: `${who} xin gỡ ${KIND_LABEL[payload.kind]} ${quoted(payload.title)}. Lý do: ${payload.reason.trim()}`,
    referenceType: REFERENCE_BY_KIND[payload.kind],
    referenceId: payload.contentId,
    actionLabel: 'Mở hàng chờ duyệt',
    actionUrl: '/moderation',
    metadata: {
      kind: payload.kind,
      slug: payload.slug,
      authorName: payload.authorName,
      reason: payload.reason.trim(),
    },
  });
}

/**
 * Gửi riêng cho TÁC GIẢ. Năm quyết định, năm câu khác nhau — người nhận cần đọc được lý
 * do ngay trên thông báo, vì đó là thứ quyết định họ phải làm gì tiếp theo.
 *
 * `archive` giờ CÓ báo — trước đây bị bỏ vì nghĩ "gỡ là việc vận hành của admin", nhưng
 * tác giả không có cách nào khác biết nội dung đang sống của họ vừa bị gỡ và vì sao, kể
 * cả khi việc gỡ đó là duyệt một yêu cầu chính họ vừa xin.
 */
export function fromContentModerated(payload: ContentModeratedV1): Draft | null {
  // Hai nhánh phát sự kiện chỉ để ghi nhật ký kiểm toán, không có gì để báo cho tác giả:
  // `restore` đưa nội dung đã gỡ về nháp, `revert` rút lại một quyết định vừa lỡ tay.
  // Báo "nội dung của bạn vừa được duyệt" rồi vài giây sau "vừa bị rút lại" là kể cho
  // tác giả nghe một cú nhấn nhầm của người khác.
  if (payload.decision === 'restore' || payload.decision === 'revert') return null;

  const label = KIND_LABEL[payload.kind];
  const name = quoted(payload.title);
  const reason = payload.reason?.trim();
  // Tên người vừa quyết đứng đầu câu: tác giả cần biết AI đã xem bài của họ, không chỉ
  // "hệ thống" nói chung — nhất là ở hai câu bị trả lại, nơi họ có thể cần hỏi lại người đó.
  const moderator = payload.moderatorName.trim() || 'Quản trị viên';

  const copy = {
    approve: {
      type: 'CONTENT_APPROVED' as const,
      title: '✅ Nội dung của bạn đã được duyệt',
      message: `${moderator} đã duyệt ${label} ${name} của bạn. Nội dung đã công khai.`,
    },
    request_changes: {
      type: 'CONTENT_CHANGES_REQUESTED' as const,
      title: '✏️ Quản trị viên yêu cầu bạn sửa lại',
      message: `${moderator} gửi lại ${label} ${name} của bạn. Lý do: ${reason ?? 'không nêu'}`,
    },
    reject: {
      type: 'CONTENT_REJECTED' as const,
      title: '❌ Nội dung của bạn bị từ chối',
      message: `${moderator} từ chối ${label} ${name} của bạn. Lý do: ${reason ?? 'không nêu'}`,
    },
    archive: {
      type: 'CONTENT_ARCHIVED' as const,
      title: '📦 Nội dung của bạn đã bị gỡ',
      message: `${moderator} đã gỡ ${label} ${name} của bạn khỏi danh mục công khai. Lý do: ${reason ?? 'không nêu'}`,
    },
    deny_removal: {
      type: 'REMOVAL_REQUEST_DENIED' as const,
      title: 'ℹ️ Yêu cầu xin gỡ của bạn không được chấp nhận',
      message: `${moderator} từ chối yêu cầu gỡ ${label} ${name} của bạn — nội dung vẫn đang công khai.`,
    },
  }[payload.decision];

  return NotificationContent.create({
    ...copy,
    audienceType: 'USER',
    audienceKey: payload.authorExternalId,
    referenceType: REFERENCE_BY_KIND[payload.kind],
    referenceId: payload.contentId,
    actionLabel: 'Mở nội dung',
    actionUrl: LECTURER_PATH[payload.kind],
    metadata: { kind: payload.kind, slug: payload.slug, reason: reason ?? null },
  });
}

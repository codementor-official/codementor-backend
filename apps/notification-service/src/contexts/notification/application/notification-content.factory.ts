import type { InvalidInput, Result } from '@codementor/kernel';
import type {
  AdminAnnouncementCreatedV1,
  CoursePublishedV1,
  ExercisePublishedV1,
  RoadmapPublishedV1,
} from '@codementor/contracts';
import { NotificationContent } from '../domain/model/notification-content';

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

import { NotificationContent } from './notification-content';
import {
  fromAdminAnnouncement,
  fromCoursePublished,
  fromExercisePublished,
  fromRoadmapPublished,
} from '../../application/notification-content.factory';

describe('NotificationContent', () => {
  const valid = {
    type: 'COURSE_PUBLISHED' as const,
    title: 'Khóa học mới',
    message: 'Nội dung',
    referenceType: 'COURSE' as const,
    referenceId: 'c1',
    actionLabel: 'Học ngay',
    actionUrl: '/courses',
  };

  it('nhận nội dung hợp lệ và cắt khoảng trắng thừa', () => {
    const result = NotificationContent.create({ ...valid, title: '  Khóa học mới  ' });
    expect(result.isOk).toBe(true);
    expect(result.value.title).toBe('Khóa học mới');
  });

  it('từ chối tiêu đề hoặc nội dung rỗng', () => {
    expect(NotificationContent.create({ ...valid, title: '   ' }).isFail).toBe(true);
    expect(NotificationContent.create({ ...valid, message: '' }).isFail).toBe(true);
  });

  // Nút bấm nửa vời chỉ lộ ra trên màn hình người dùng thật nếu không chặn ở đây.
  it('từ chối actionLabel và actionUrl lệch nhau', () => {
    expect(NotificationContent.create({ ...valid, actionUrl: null }).isFail).toBe(true);
    expect(NotificationContent.create({ ...valid, actionLabel: null }).isFail).toBe(true);
  });

  it('từ chối actionUrl trỏ ra ngoài CodeMentor', () => {
    expect(
      NotificationContent.create({ ...valid, actionUrl: 'https://example.com' }).isFail,
    ).toBe(true);
  });

  it('bắt buộc tài nguyên với thông báo nội dung, và cấm với thông báo admin', () => {
    expect(
      NotificationContent.create({ ...valid, referenceType: null, referenceId: null }).isFail,
    ).toBe(true);
    expect(
      NotificationContent.create({
        type: 'ADMIN_ANNOUNCEMENT',
        title: 'Bảo trì',
        message: 'Từ 22:00',
        referenceType: 'COURSE',
        referenceId: 'c1',
      }).isFail,
    ).toBe(true);
  });
});

describe('dựng nội dung từ sự kiện', () => {
  it('khóa học: nêu tên giảng viên khi có', () => {
    const result = fromCoursePublished({
      courseId: 'c1',
      slug: 'spring-boot',
      title: 'Spring Boot',
      lecturerName: 'Nguyễn Văn A',
    });
    expect(result.isOk).toBe(true);
    expect(result.value.message).toContain('Giảng viên Nguyễn Văn A');
    expect(result.value.actionUrl).toBe('/courses');
  });

  // Tài khoản giảng viên đã xoá: câu văn vẫn phải đọc được, không hiện "null".
  it('khóa học: không có tên giảng viên thì đổi cách xưng', () => {
    const result = fromCoursePublished({
      courseId: 'c1',
      slug: 's',
      title: 'Spring Boot',
      lecturerName: null,
    });
    expect(result.value.message).toContain('CodeMentor vừa ra mắt');
    expect(result.value.message).not.toContain('null');
  });

  it('bài tập trỏ tới trang giải, lộ trình trỏ theo slug', () => {
    const exercise = fromExercisePublished({
      exerciseId: 'e1',
      visibility: 'public',
      title: 'Java Array',
      slug: 'java-array',
    });
    expect(exercise.value.actionUrl).toBe('/solve/e1');

    const roadmap = fromRoadmapPublished({ roadmapId: 'r1', slug: 'backend', title: 'Backend' });
    expect(roadmap.value.actionUrl).toBe('/paths/backend');
  });

  it('thông báo admin không có nút bấm và không gắn tài nguyên', () => {
    const result = fromAdminAnnouncement({
      announcementId: 'a1',
      title: 'Bảo trì hệ thống',
      message: 'Từ 22:00 đến 23:00.',
    });
    expect(result.isOk).toBe(true);
    expect(result.value.actionUrl).toBeNull();
    expect(result.value.actionLabel).toBeNull();
    expect(result.value.referenceType).toBeNull();
  });
});

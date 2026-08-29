import { NotificationContent } from './notification-content';
import {
  fromAdminAnnouncement,
  fromAssignmentCreated,
  fromContentModerated,
  fromContentReviewRequested,
  fromCoursePublished,
  fromExercisePublished,
  fromRoadmapPublished,
  fromWorkspaceJoinReviewed,
} from '../../application/notification-content.factory';

describe('NotificationContent', () => {
  const valid = {
    type: 'COURSE_PUBLISHED' as const,
    title: 'Khóa học mới',
    message: 'Nội dung',
    referenceType: 'COURSE' as const,
    referenceId: 'c1',
    actionLabel: 'Học ngay',
    actionUrl: '/courses/c1',
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
    expect(NotificationContent.create({ ...valid, actionUrl: 'https://example.com' }).isFail).toBe(
      true,
    );
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
  it('mặc định gửi cho tất cả, và ALL không được mang khoá đối tượng', () => {
    expect(NotificationContent.create(valid).value.audienceType).toBe('ALL');
    expect(NotificationContent.create(valid).value.audienceKey).toBeNull();
    expect(NotificationContent.create({ ...valid, audienceKey: 'admin' }).isFail).toBe(true);
  });

  it('ROLE/USER không có khoá thì bị từ chối — nếu không, thông báo lưu được mà không ai đọc được', () => {
    expect(NotificationContent.create({ ...valid, audienceType: 'ROLE' }).isFail).toBe(true);
    expect(NotificationContent.create({ ...valid, audienceType: 'USER' }).isFail).toBe(true);
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
    expect(result.value.actionUrl).toBe('/courses/c1');
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
    expect(roadmap.value.actionUrl).toBe('/roadmaps/r1');
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

  it('kết quả duyệt nhóm gửi riêng cho đúng tài khoản và deep-link tới Workspace', () => {
    const result = fromWorkspaceJoinReviewed({
      groupId: 'g1',
      workspaceSlug: 'nhom-dsa',
      workspaceName: 'Nhóm DSA',
      memberExternalId: 'keycloak-member-1',
      decision: 'approved',
    });
    expect(result.isOk).toBe(true);
    expect(result.value.type).toBe('WORKSPACE_JOIN_APPROVED');
    expect(result.value.audienceType).toBe('USER');
    expect(result.value.audienceKey).toBe('keycloak-member-1');
    expect(result.value.actionUrl).toBe('/workspace/nhom-dsa');
  });

  it('bài tập mới chứa deadline và mở đúng tab bài tập của Workspace', () => {
    const result = fromAssignmentCreated(
      {
        groupId: 'g1',
        workspaceSlug: 'nhom-dsa',
        workspaceName: 'Nhóm DSA',
        groupExerciseId: 'ge1',
        exerciseId: 'e1',
        memberIds: ['m1'],
        memberExternalIds: ['sub-1'],
        exerciseTitle: 'Duyệt đồ thị BFS',
        dueAt: '2026-09-01T10:00:00.000Z',
      },
      'sub-1',
    );
    expect(result.value.type).toBe('WORKSPACE_ASSIGNMENT_CREATED');
    expect(result.value.audienceKey).toBe('sub-1');
    expect(result.value.message).toContain('Hạn nộp');
    expect(result.value.actionUrl).toBe('/workspace/nhom-dsa?tab=exercises');
  });

  it('gửi duyệt báo cho admin, không phải cho người học', () => {
    const result = fromContentReviewRequested({
      kind: 'POST',
      contentId: 'a1',
      slug: 'bai-viet',
      title: 'Bài viết',
      authorName: 'Gia Sĩ',
    });
    expect(result.isOk).toBe(true);
    expect(result.value.audienceType).toBe('ROLE');
    expect(result.value.audienceKey).toBe('admin');
    expect(result.value.actionUrl).toBe('/moderation');
  });

  it('quyết định của admin gửi riêng cho tác giả, kèm tên người quyết và lý do', () => {
    const changes = fromContentModerated({
      kind: 'COURSE',
      contentId: 'c1',
      slug: 'khoa-hoc',
      title: 'Khoá học',
      decision: 'request_changes',
      reason: 'Thiếu bài học',
      authorExternalId: 'sub-123',
      moderatorName: 'Admin Test',
      moderatorExternalId: 'sub-admin',
    });
    expect(changes?.value.audienceType).toBe('USER');
    expect(changes?.value.audienceKey).toBe('sub-123');
    expect(changes?.value.message).toContain('Thiếu bài học');
    expect(changes?.value.message).toContain('Admin Test');
  });

  it('lưu trữ báo cho tác giả biết nội dung của họ vừa bị gỡ và vì sao', () => {
    const archived = fromContentModerated({
      kind: 'COURSE',
      contentId: 'c1',
      slug: 'khoa-hoc',
      title: 'Khoá học',
      decision: 'archive',
      reason: 'Vi phạm bản quyền ảnh minh hoạ',
      authorExternalId: 'sub-123',
      moderatorName: 'Admin Test',
      moderatorExternalId: 'sub-admin',
    });
    expect(archived?.value.type).toBe('CONTENT_ARCHIVED');
    expect(archived?.value.audienceType).toBe('USER');
    expect(archived?.value.audienceKey).toBe('sub-123');
    expect(archived?.value.message).toContain('Vi phạm bản quyền ảnh minh hoạ');
  });

  it('từ chối yêu cầu xin gỡ báo cho tác giả biết nội dung vẫn đang công khai', () => {
    const denied = fromContentModerated({
      kind: 'COURSE',
      contentId: 'c1',
      slug: 'khoa-hoc',
      title: 'Khoá học',
      decision: 'deny_removal',
      reason: null,
      authorExternalId: 'sub-123',
      moderatorName: 'Admin Test',
      moderatorExternalId: 'sub-admin',
    });
    expect(denied?.value.type).toBe('REMOVAL_REQUEST_DENIED');
    expect(denied?.value.audienceKey).toBe('sub-123');
  });
});

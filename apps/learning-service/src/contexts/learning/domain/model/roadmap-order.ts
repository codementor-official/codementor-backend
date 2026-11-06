/**
 * Thứ tự khóa trong lộ trình là khóa MỀM (ADR 0005): không chặn, chỉ nói cho học viên biết
 * họ đang bỏ qua khóa nào để client hỏi lại trước khi bắt đầu.
 *
 * Tính bằng TypeScript từ chính các hàng tiến độ đã truy vấn, không gọi
 * `fn_roadmap_course_available`: hàm đó (và `fn_course_available`) đã bị migration 0021 xóa.
 */
export interface OrderedRoadmapCourse {
  courseId: string;
  position: number;
  title: string;
  isOptional: boolean;
  enrollmentStatus: string | null;
}

export interface BlockingCourse {
  courseId: string;
  position: number;
  title: string;
}

/**
 * Các khóa bắt buộc đứng trước `courseId` mà học viên chưa hoàn thành.
 *
 * `free` thì không có thứ tự nào để bỏ qua. `graph` và `linear` cùng nghĩa "có thứ tự": `graph`
 * đọc bảng prerequisite chưa từng có ai ghi, nên ở cấp lộ trình nó chưa bao giờ khác `linear`.
 * Khóa tự chọn không chặn ai. Khóa không thuộc lộ trình thì trả rỗng.
 */
export function blockedBy(
  courses: readonly OrderedRoadmapCourse[],
  courseId: string,
  mode: string,
): BlockingCourse[] {
  if (mode === 'free') return [];
  const target = courses.find((course) => course.courseId === courseId);
  if (!target) return [];
  return courses
    .filter(
      (course) =>
        course.position < target.position &&
        !course.isOptional &&
        course.enrollmentStatus !== 'completed',
    )
    .sort((a, b) => a.position - b.position)
    .map(({ courseId: id, position, title }) => ({ courseId: id, position, title }));
}

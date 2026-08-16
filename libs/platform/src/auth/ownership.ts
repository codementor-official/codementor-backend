import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from './jwt-payload';

/**
 * Mọi quyết định "người này có được động vào bản ghi kia không" nằm ở đây, một chỗ duy nhất.
 *
 * `@Roles('lecturer')` chỉ trả lời "được vào cửa không" — nó không biết gì về bản ghi cụ
 * thể. Còn "bản ghi này có phải của anh không" là câu hỏi khác, và nếu để mỗi use case tự
 * viết thì sớm muộn sẽ có chỗ quên, hoặc có chỗ kiểm khác chỗ kia.
 *
 * Khi thêm cộng tác viên sau này (bảng `collaborators` — chưa làm), chỉ sửa các hàm trong
 * file này, không phải đi rà lại toàn hệ thống.
 */

/**
 * Id của con người đứng sau request, khi bản ghi sắp tạo phải có chủ.
 *
 * `AuthenticatedUser.id` là `string | null` vì tài khoản dịch vụ (AI agent) không có hàng
 * nào trong `users`. Ghi thẳng giá trị đó vào `author_id`/`created_by` sẽ tạo ra bản ghi vô
 * chủ — mà theo `owns()` bên dưới thì bản ghi vô chủ chỉ admin đụng được, nên tác giả thật
 * mất luôn quyền sửa bài của mình.
 *
 * Một chỗ duy nhất ném lỗi, thay vì mỗi use case tự nhớ kiểm — quên một chỗ là đủ.
 */
export function requireHumanId(user: AuthenticatedUser): string {
  if (user.actorType !== 'human' || !user.id) {
    throw new ForbiddenException('Tài khoản dịch vụ không tạo hay sở hữu nội dung được');
  }
  return user.id;
}

/** Chỉ cần đúng những trường dùng để quyết định — không nhận cả aggregate. */
export interface OwnedByAuthor {
  author_id: string | null;
}

export interface OwnedByCreator {
  created_by: string | null;
}

function owns(user: AuthenticatedUser, ownerId: string | null): boolean {
  // Bản ghi mất chủ (tác giả bị xoá → ON DELETE SET NULL) không thuộc về ai. Coi nó là
  // của mọi người thì một lecturer bất kỳ sẽ sửa được nội dung của người đã rời đi.
  if (ownerId === null) return user.role === 'admin';
  return ownerId === user.id || user.role === 'admin';
}

export function canEditExercise(user: AuthenticatedUser, exercise: OwnedByAuthor): boolean {
  return owns(user, exercise.author_id);
}

export function canEditCourse(user: AuthenticatedUser, course: OwnedByCreator): boolean {
  return owns(user, course.created_by);
}

export function canEditRoadmap(user: AuthenticatedUser, roadmap: OwnedByCreator): boolean {
  return owns(user, roadmap.created_by);
}

/**
 * Đọc bài tập. Phức tạp hơn sửa vì có một đường thứ ba ngoài "của tôi" và "công khai".
 *
 * Một bài chưa `published` VẪN phải hiển thị cho học viên đang học chương tham chiếu nó —
 * nếu không, giảng viên phải công khai mọi bài ra catalog chỉ để dùng trong khoá học của
 * mình. Đường thứ ba đó cần truy vấn CSDL nên nó là tham số, không tự tra ở đây: tầng
 * domain không được biết cách hỏi CSDL.
 *
 * Chiều ngược lại KHÔNG đúng: bài chưa published nằm trong khoá học đã duyệt vẫn không
 * xuất hiện ở catalog. Hai phạm vi tách biệt.
 */
export interface ExerciseAccess extends OwnedByAuthor {
  visibility: string;
  status: string;
}

export function canViewExercise(
  user: AuthenticatedUser,
  exercise: ExerciseAccess,
  enrolledInReferencingCourse = false,
): boolean {
  if (exercise.author_id !== null && exercise.author_id === user.id) return true;
  if (user.role === 'admin') return true;
  if (exercise.visibility === 'public' && exercise.status === 'published') return true;
  return enrolledInReferencingCourse;
}

/**
 * Chỉ tác giả mới sửa được, và chỉ khi bài không đang chờ duyệt.
 *
 * Cho sửa lúc `pending_review` nghĩa là admin có thể duyệt một bản khác bản họ đã đọc.
 * Lối thoát là `withdraw` đưa về `draft` — xem `codementor-content-model.md` §8.2.
 */
export function isLockedForReview(status: string): boolean {
  return status === 'pending_review';
}

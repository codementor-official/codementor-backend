import {
  canEditCourse,
  canEditExercise,
  canViewExercise,
  isLockedForReview,
} from './ownership';
import type { AuthenticatedUser, PlatformRole } from './jwt-payload';

const user = (id: string, role: PlatformRole = 'lecturer'): AuthenticatedUser => ({
  id,
  externalId: `kc-${id}`,
  email: `${id}@test.local`,
  displayName: id,
  role,
});

const me = user('u1');
const other = user('u2');
const admin = user('root', 'admin');
const learner = user('l1', 'learner');

describe('canEditExercise / canEditCourse', () => {
  it('tác giả sửa được bài của mình', () => {
    expect(canEditExercise(me, { author_id: 'u1' })).toBe(true);
    expect(canEditCourse(me, { created_by: 'u1' })).toBe(true);
  });

  it('không sửa được bài của người khác', () => {
    expect(canEditExercise(me, { author_id: 'u2' })).toBe(false);
    expect(canEditCourse(me, { created_by: 'u2' })).toBe(false);
  });

  it('admin sửa được tất cả', () => {
    expect(canEditExercise(admin, { author_id: 'u2' })).toBe(true);
    expect(canEditCourse(admin, { created_by: 'u2' })).toBe(true);
  });

  // author_id là ON DELETE SET NULL. Coi bản ghi mất chủ là của mọi người thì một
  // lecturer bất kỳ sẽ sửa được nội dung của người đã rời nền tảng.
  it('bản ghi mất chủ chỉ admin động được', () => {
    expect(canEditExercise(me, { author_id: null })).toBe(false);
    expect(canEditExercise(other, { author_id: null })).toBe(false);
    expect(canEditExercise(admin, { author_id: null })).toBe(true);
  });
});

describe('canViewExercise', () => {
  const published = { author_id: 'u2', visibility: 'public', status: 'published' };
  const draft = { author_id: 'u2', visibility: 'public', status: 'draft' };
  const groupOnly = { author_id: 'u2', visibility: 'group', status: 'published' };

  it('bài đã published trong catalog thì ai cũng xem được', () => {
    expect(canViewExercise(learner, published)).toBe(true);
    expect(canViewExercise(me, published)).toBe(true);
  });

  it('bài nháp của người khác thì không', () => {
    expect(canViewExercise(learner, draft)).toBe(false);
    expect(canViewExercise(me, draft)).toBe(false);
  });

  it('tác giả và admin luôn xem được bài nháp', () => {
    expect(canViewExercise(other, draft)).toBe(true);
    expect(canViewExercise(admin, draft)).toBe(true);
  });

  // Điểm nghiệp vụ chính: không có nó thì giảng viên phải công khai mọi bài ra catalog
  // chỉ để dùng được trong khoá học của mình.
  it('học viên đang học chương tham chiếu thì xem được bài chưa published', () => {
    expect(canViewExercise(learner, draft, true)).toBe(true);
    expect(canViewExercise(learner, groupOnly, true)).toBe(true);
  });

  it('bài visibility=group không lọt ra catalog chung', () => {
    expect(canViewExercise(learner, groupOnly)).toBe(false);
  });
});

describe('isLockedForReview', () => {
  it('chỉ khoá đúng lúc đang chờ duyệt', () => {
    expect(isLockedForReview('pending_review')).toBe(true);
    for (const status of ['draft', 'changes_requested', 'rejected', 'published', 'archived']) {
      expect(isLockedForReview(status)).toBe(false);
    }
  });
});

import { blockedBy, type OrderedRoadmapCourse } from './roadmap-order';

const course = (
  position: number,
  enrollmentStatus: string | null = null,
  isOptional = false,
): OrderedRoadmapCourse => ({
  courseId: `c${position}`,
  position,
  title: `Khóa ${position}`,
  isOptional,
  enrollmentStatus,
});

describe('blockedBy', () => {
  it('lists every earlier required course not completed, in order', () => {
    const courses = [course(3), course(1), course(2, 'active')];
    expect(blockedBy(courses, 'c3', 'graph').map((c) => c.position)).toEqual([1, 2]);
  });

  it('ignores completed and optional courses', () => {
    const courses = [course(1, 'completed'), course(2, null, true), course(3)];
    expect(blockedBy(courses, 'c3', 'linear')).toEqual([]);
  });

  it('never blocks the first course or anything in free mode', () => {
    const courses = [course(1), course(2)];
    expect(blockedBy(courses, 'c1', 'graph')).toEqual([]);
    expect(blockedBy(courses, 'c2', 'free')).toEqual([]);
  });

  it('returns nothing for a course outside the roadmap', () => {
    expect(blockedBy([course(1)], 'other', 'graph')).toEqual([]);
  });
});

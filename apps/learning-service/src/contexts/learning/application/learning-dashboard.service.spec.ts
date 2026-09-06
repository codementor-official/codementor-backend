import { LearningDashboardService } from './learning-dashboard.service';
import { EnrollmentUseCases } from './enrollment.usecases';
import { UserActivityUseCases } from './user-activity.usecases';
import { PrismaService, type AuthenticatedUser } from '@codementor/platform';

// This projection does not exercise the JWT adapter (jwks-rsa loads ESM-only jose).
jest.mock('@codementor/platform', () => ({
  requireHumanId: jest.requireActual('../../../../../../libs/platform/src/auth/ownership').requireHumanId,
  PrismaService: class {},
}));

describe('LearningDashboardService', () => {
  const actor: AuthenticatedUser = { id: '00000000-0000-4000-8000-000000000001', externalId: 'test', displayName: 'Test learner', role: 'learner', actorType: 'human' };
  const courses = jest.fn();
  const roadmaps = jest.fn();
  const mine = jest.fn();
  const calendar = jest.fn();
  const aggregate = jest.fn();
  const service = new LearningDashboardService(
    { myCourses: courses, myRoadmaps: roadmaps } as unknown as EnrollmentUseCases,
    { mine, calendar } as unknown as UserActivityUseCases,
    { users: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Ho_Chi_Minh' }) }, lesson_progress: { aggregate } } as unknown as PrismaService,
  );

  beforeEach(() => {
    courses.mockReset().mockResolvedValue([]);
    roadmaps.mockReset().mockResolvedValue([]);
    mine.mockReset().mockResolvedValue([]);
    calendar.mockReset().mockResolvedValue({ days: [], totalActivities: 0 });
    aggregate.mockReset().mockResolvedValue({ _sum: { time_spent_seconds: null } });
  });

  it('uses the authenticated user and preserves genuine empty results', async () => {
    const result = await service.mine(actor);
    expect(courses).toHaveBeenCalledWith(actor);
    expect(calendar).toHaveBeenCalledWith(actor, 8, 'Asia/Ho_Chi_Minh');
    expect(aggregate).toHaveBeenCalledWith({ where: { user_id: actor.id }, _sum: { time_spent_seconds: true } });
    expect(result).toMatchObject({ courses: [], roadmaps: [], totalStudySeconds: 0 });
  });

  it('isolates a failed subsection instead of misreporting no enrollments', async () => {
    courses.mockRejectedValue(new Error('unavailable'));
    aggregate.mockResolvedValue({ _sum: { time_spent_seconds: 3600 } });
    const result = await service.mine(actor);
    expect(result.courses).toBeNull();
    expect(result.roadmaps).toEqual([]);
    expect(result.totalStudySeconds).toBe(3600);
  });

  it('rejects service accounts before querying learner data', async () => {
    await expect(service.mine({ ...actor, id: null, actorType: 'service' })).rejects.toThrow();
  });
});

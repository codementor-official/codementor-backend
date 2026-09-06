import { Injectable } from '@nestjs/common';
import { PrismaService, requireHumanId, type AuthenticatedUser } from '@codementor/platform';
import { EnrollmentUseCases } from './enrollment.usecases';
import { UserActivityUseCases } from './user-activity.usecases';

/** Bounded learning projection. Other domains stay behind their own APIs. */
@Injectable()
export class LearningDashboardService {
  constructor(
    private readonly enrollments: EnrollmentUseCases,
    private readonly activity: UserActivityUseCases,
    private readonly prisma: PrismaService,
  ) {}

  async mine(actor: AuthenticatedUser) {
    const userId = requireHumanId(actor);
    const profile = await this.prisma.users.findUnique({ where: { id: userId }, select: { timezone: true } });
    const timezone = profile?.timezone ?? 'UTC';
    const [courses, roadmaps, activities, calendar, studyTime] = await Promise.allSettled([
      this.enrollments.myCourses(actor),
      this.enrollments.myRoadmaps(actor),
      this.activity.mine(actor, 8),
      this.activity.calendar(actor, 8, timezone),
      this.prisma.lesson_progress.aggregate({
        where: { user_id: userId },
        _sum: { time_spent_seconds: true },
      }),
    ]);
    return {
      timezone,
      courses: courses.status === 'fulfilled' ? courses.value : null,
      roadmaps: roadmaps.status === 'fulfilled' ? roadmaps.value : null,
      activities: activities.status === 'fulfilled' ? activities.value : null,
      calendar: calendar.status === 'fulfilled' ? calendar.value : null,
      totalStudySeconds: studyTime.status === 'fulfilled' ? studyTime.value._sum.time_spent_seconds ?? 0 : null,
    };
  }
}

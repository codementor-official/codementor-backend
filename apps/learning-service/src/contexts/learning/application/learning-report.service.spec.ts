import { summarize, type CourseReportRow, type RoadmapReportRow } from './learning-report.service';

jest.mock('@codementor/platform', () => ({ PrismaService: class {} }));

const course = (over: Partial<CourseReportRow>): CourseReportRow => ({
  id: 'c', title: 'C', status: 'published', enrolled: 0, notStarted: 0, inProgress: 0, stalled: 0,
  completed: 0, dropped: 0, newEnrollments: 0, recentCompletions: 0, avgProgress: 0,
  medianDaysToComplete: null, outOfOrder: 0, certificates: 0, recentCertificates: 0, ...over,
});

describe('summarize', () => {
  it('adds rows and computes completion rate over non-dropped enrollments', () => {
    const roadmap = { ...course({ enrolled: 4, completed: 1, certificates: 1 }), funnel: [] } as RoadmapReportRow;
    const s = summarize(
      [course({ enrolled: 3, completed: 1, stalled: 1, outOfOrder: 2, certificates: 1 }), course({ enrolled: 1, completed: 1, dropped: 5 })],
      [roadmap],
    );
    expect(s.courseEnrollments).toBe(4);
    expect(s.completionRate).toBe(50);
    expect(s.certificates).toBe(2);
    expect(s.roadmapsCompleted).toBe(1);
    expect(s.outOfOrderStarts).toBe(2);
  });

  it('reports 0% rather than NaN with no enrollments', () => {
    expect(summarize([], []).completionRate).toBe(0);
  });
});

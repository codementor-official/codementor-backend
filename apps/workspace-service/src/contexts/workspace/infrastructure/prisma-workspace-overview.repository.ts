import { Injectable } from '@nestjs/common';
import { assignment_status, document_status, exercise_status, member_status, submission_verdict } from '@prisma/client';
import { PrismaService } from '@codementor/platform';
import type { WorkspaceOverviewRepository } from '../domain/port/workspace-overview.repository';

/** Read-model adapter for the overview. It owns no policy; WorkspaceService checks access first. */
@Injectable()
export class PrismaWorkspaceOverviewRepository implements WorkspaceOverviewRepository {
  constructor(private readonly prisma: PrismaService) {}

  async get(groupId: string) {
    const since = startOfUtcDay(-27);

    const [documents, exercises, assignments, members, activities, recentActivities, submissions] = await Promise.all([
      this.prisma.group_documents.groupBy({ by: ['status'], where: { group_id: groupId }, _count: { _all: true } }),
      this.prisma.group_exercises.findMany({ where: { group_id: groupId }, select: { due_at: true, exercises: { select: { status: true } } } }),
      this.prisma.assignments.findMany({ where: { group_id: groupId }, select: { member_id: true, status: true } }),
      this.prisma.group_members.findMany({
        where: { group_id: groupId, status: member_status.active },
        orderBy: [{ role: 'asc' }, { joined_at: 'asc' }],
        include: { users: { select: { display_name: true, email: true, avatar_url: true, user_stats: { select: { xp: true, solved_count: true, current_streak_days: true } } } } },
      }),
      this.prisma.group_activities.findMany({
        where: { group_id: groupId }, orderBy: { created_at: 'desc' }, take: 18,
        include: { users: { select: { display_name: true } } },
      }),
      this.prisma.group_activities.findMany({ where: { group_id: groupId, created_at: { gte: since } }, select: { actor_id: true, created_at: true } }),
      this.prisma.submissions.findMany({
        where: { assignments: { group_id: groupId } },
        select: { assignment_id: true, user_id: true, verdict: true, score: true, submitted_at: true },
      }),
    ]);

    const documentCount = (status: document_status) => documents.find((item) => item.status === status)?._count._all ?? 0;
    const completedAssignment = (status: assignment_status) => status === assignment_status.done || status === assignment_status.late;
    const assignmentCompleted = assignments.filter((item) => completedAssignment(item.status)).length;
    const assignmentLate = assignments.filter((item) => item.status === assignment_status.late).length;
    const assignmentInProgress = assignments.filter((item) => item.status === assignment_status.inprogress).length;
    const assignmentNotStarted = assignments.filter((item) => item.status === assignment_status.notstarted).length;
    const accepted = submissions.filter((item) => item.verdict === submission_verdict.accepted);
    const failed = submissions.filter((item) => item.verdict !== submission_verdict.accepted && item.verdict !== submission_verdict.pending);
    const scores = submissions.flatMap((item) => item.score === null ? [] : [item.score]);
    const attemptsByAssignment = new Map<string, number>();
    submissions.forEach((item) => { if (item.assignment_id) attemptsByAssignment.set(item.assignment_id, (attemptsByAssignment.get(item.assignment_id) ?? 0) + 1); });
    const attemptCounts = [...attemptsByAssignment.values()];
    const now = new Date();
    const submissionTrend = trend(14, (day, nextDay) => submissions.filter((row) => row.submitted_at >= day && row.submitted_at < nextDay).length);
    const completionTrend = trend(14, (day, nextDay) => accepted.filter((row) => row.submitted_at >= day && row.submitted_at < nextDay).length);
    const activityTrend = trend(28, (day, nextDay) => recentActivities.filter((row) => row.created_at >= day && row.created_at < nextDay).length);

    const overviewMembers = members.map((member) => {
      const memberAssignments = assignments.filter((assignment) => assignment.member_id === member.id);
      const completedCount = memberAssignments.filter((assignment) => completedAssignment(assignment.status)).length;
      const memberSubmissions = submissions.filter((submission) => submission.user_id === member.user_id);
      const memberScores = memberSubmissions.flatMap((submission) => submission.score === null ? [] : [submission.score]);
      return { id: member.id, displayName: member.users.display_name, email: member.users.email, avatarUrl: member.users.avatar_url, role: member.role, joinedAt: member.joined_at, xp: member.users.user_stats?.xp ?? 0, solvedCount: member.users.user_stats?.solved_count ?? 0, streakDays: member.users.user_stats?.current_streak_days ?? 0, assignedCount: memberAssignments.length, completedCount, completionRate: memberAssignments.length === 0 ? 0 : Math.round(completedCount / memberAssignments.length * 100), submissionCount: memberSubmissions.length, acceptedCount: memberSubmissions.filter((submission) => submission.verdict === submission_verdict.accepted).length, averageScore: average(memberScores), activityCount: recentActivities.filter((activity) => activity.actor_id === member.user_id).length };
    });
    const learners = overviewMembers.filter((member) => member.assignedCount > 0);
    const progressDistribution = [
      { key: 'complete', label: 'Hoàn thành 100%', value: learners.filter((item) => item.completionRate === 100).length },
      { key: 'advanced', label: '70–99%', value: learners.filter((item) => item.completionRate >= 70 && item.completionRate < 100).length },
      { key: 'steady', label: '40–69%', value: learners.filter((item) => item.completionRate >= 40 && item.completionRate < 70).length },
      { key: 'starting', label: '1–39%', value: learners.filter((item) => item.completionRate > 0 && item.completionRate < 40).length },
      { key: 'not_started', label: 'Chưa bắt đầu', value: learners.filter((item) => item.completionRate === 0).length },
    ];
    return {
      documents: { total: documents.reduce((total, item) => total + item._count._all, 0), published: documentCount(document_status.published), pending: documentCount(document_status.pending) },
      exercises: { total: exercises.length, open: exercises.filter((item) => item.exercises.status === exercise_status.published && (!item.due_at || item.due_at >= now)).length },
      assignments: { total: assignments.length, completed: assignmentCompleted, inProgress: assignmentInProgress, notStarted: assignmentNotStarted, late: assignmentLate, completionRate: assignments.length === 0 ? 0 : Math.round(assignmentCompleted / assignments.length * 100) },
      submissions: { total: submissions.length, accepted: accepted.length, failed: failed.length, acceptanceRate: submissions.length === 0 ? 0 : Math.round(accepted.length / submissions.length * 100), averageScore: average(scores), averageAttempts: average(attemptCounts), maxAttempts: attemptCounts.length ? Math.max(...attemptCounts) : 0 },
      members: overviewMembers,
      activities: activities.map((activity) => ({ id: activity.id, actor: activity.users?.display_name ?? null, action: activity.action, targetType: activity.target_type, createdAt: activity.created_at })),
      submissionTrend, completionTrend, activityTrend, progressDistribution,
    };
  }
}

function startOfUtcDay(offset = 0) { const day = new Date(); day.setUTCHours(0, 0, 0, 0); day.setUTCDate(day.getUTCDate() + offset); return day; }
function trend(days: number, count: (day: Date, nextDay: Date) => number) { return Array.from({ length: days }, (_, index) => { const day = startOfUtcDay(-(days - 1 - index)); const nextDay = new Date(day); nextDay.setUTCDate(nextDay.getUTCDate() + 1); return { label: new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' }).format(day), value: count(day, nextDay) }; }); }
function average(values: number[]) { return values.length === 0 ? 0 : Math.round(values.reduce((total, value) => total + value, 0) / values.length); }

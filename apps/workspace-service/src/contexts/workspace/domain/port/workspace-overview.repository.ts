export interface WorkspaceOverviewMember {
  id: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  role: 'owner' | 'deputy' | 'member';
  joinedAt: Date;
  xp: number;
  solvedCount: number;
  streakDays: number;
  assignedCount: number;
  completedCount: number;
  completionRate: number;
  submissionCount: number;
  acceptedCount: number;
  averageScore: number;
  activityCount: number;
}

export interface WorkspaceOverviewActivity {
  id: string;
  actor: string | null;
  action: string;
  targetType: string | null;
  createdAt: Date;
}

export interface WorkspaceOverviewData {
  documents: { total: number; published: number; pending: number };
  exercises: { total: number; open: number };
  assignments: { total: number; completed: number; inProgress: number; notStarted: number; late: number; completionRate: number };
  submissions: { total: number; accepted: number; failed: number; acceptanceRate: number; averageScore: number; averageAttempts: number; maxAttempts: number };
  members: WorkspaceOverviewMember[];
  activities: WorkspaceOverviewActivity[];
  activityPagination: { page: number; limit: number; total: number; totalPages: number };
  submissionTrend: Array<{ label: string; value: number }>;
  completionTrend: Array<{ label: string; value: number }>;
  activityTrend: Array<{ label: string; value: number }>;
  progressDistribution: Array<{ key: string; label: string; value: number }>;
}

export interface WorkspaceOverviewRepository {
  get(
    groupId: string,
    input?: { activitySearch?: string; activityPage?: number; activityLimit?: number },
  ): Promise<WorkspaceOverviewData>;
}

export const WORKSPACE_OVERVIEW_REPOSITORY = Symbol('WORKSPACE_OVERVIEW_REPOSITORY');

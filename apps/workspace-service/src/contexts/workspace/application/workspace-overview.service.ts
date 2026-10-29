import { Inject, Injectable } from '@nestjs/common';
import {
  WORKSPACE_OVERVIEW_REPOSITORY,
  type WorkspaceOverviewRepository,
} from '../domain/port/workspace-overview.repository';
import { WorkspaceService } from './workspace.service';
import type { WorkspaceOverviewQueryDto } from '../presentation/dto/workspace.dto';

/** Application use case: authorize with the Workspace aggregate, then read its dashboard projection. */
@Injectable()
export class WorkspaceOverviewService {
  constructor(
    private readonly workspaces: WorkspaceService,
    @Inject(WORKSPACE_OVERVIEW_REPOSITORY) private readonly overview: WorkspaceOverviewRepository,
  ) {}

  async get(userId: string, slug: string, query: WorkspaceOverviewQueryDto = {}) {
    const detail = await this.workspaces.detail(userId, slug);
    const data = await this.overview.get(detail.id, {
      activitySearch: query.activitySearch?.trim() || undefined,
      activityPage: query.activityPage ?? 1,
      activityLimit: query.activityLimit ?? 12,
    });
    const members =
      detail.currentMembership.role === 'member'
        ? data.members.map(({ email: _email, ...member }) => member)
        : data.members;
    const detailed = detail.plan.features.includes('detailed_analytics');
    return {
      ...data,
      // Without the plan feature the group keeps its totals; per-member progress and trends are paid.
      detailedAnalytics: detailed,
      activeLearners: data.members.filter((member) => member.assignedCount > 0).length,
      members: detailed ? members : [],
      submissionTrend: detailed ? data.submissionTrend : [],
      completionTrend: detailed ? data.completionTrend : [],
      memberCount: detail.memberCount,
      createdAt: detail.createdAt,
      topic: detail.topic,
    };
  }
}

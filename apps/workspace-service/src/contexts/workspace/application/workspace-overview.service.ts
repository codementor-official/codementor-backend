import { Inject, Injectable } from '@nestjs/common';
import { WORKSPACE_OVERVIEW_REPOSITORY, type WorkspaceOverviewRepository } from '../domain/port/workspace-overview.repository';
import { WorkspaceService } from './workspace.service';

/** Application use case: authorize with the Workspace aggregate, then read its dashboard projection. */
@Injectable()
export class WorkspaceOverviewService {
  constructor(
    private readonly workspaces: WorkspaceService,
    @Inject(WORKSPACE_OVERVIEW_REPOSITORY) private readonly overview: WorkspaceOverviewRepository,
  ) {}

  async get(userId: string, slug: string) {
    const detail = await this.workspaces.detail(userId, slug);
    const data = await this.overview.get(detail.id);
    return { ...data, memberCount: detail.memberCount, createdAt: detail.createdAt, topic: detail.topic };
  }
}

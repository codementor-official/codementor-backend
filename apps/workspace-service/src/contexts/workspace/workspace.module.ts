import { Module } from '@nestjs/common';
import { WorkspaceAiService } from './application/workspace-ai.service';
import { WorkspaceAiClient } from './infrastructure/workspace-ai.client';
import { WorkspaceAiController } from './presentation/workspace-ai.controller';
import { WorkspaceService } from './application/workspace.service';
import { WORKSPACE_REPOSITORY } from './domain/port/workspace.repository';
import { PrismaWorkspaceRepository } from './infrastructure/prisma-workspace.repository';
import { WorkspaceController } from './presentation/workspace.controller';
import { WorkspaceOverviewService } from './application/workspace-overview.service';
import { WORKSPACE_OVERVIEW_REPOSITORY } from './domain/port/workspace-overview.repository';
import { PrismaWorkspaceOverviewRepository } from './infrastructure/prisma-workspace-overview.repository';
import { WorkspaceContentService } from './application/workspace-content.service';
import { WORKSPACE_CONTENT_REPOSITORY } from './domain/port/workspace-content.repository';
import { PrismaWorkspaceContentRepository } from './infrastructure/prisma-workspace-content.repository';
import { WorkspaceChatService } from './application/workspace-chat.service';
import { WORKSPACE_CHAT_REPOSITORY } from './domain/port/workspace-chat.repository';
import { PrismaWorkspaceChatRepository } from './infrastructure/prisma-workspace-chat.repository';

@Module({
  controllers: [WorkspaceController, WorkspaceAiController],
  providers: [
    WorkspaceAiService,
    WorkspaceAiClient,
    WorkspaceService,
    WorkspaceOverviewService,
    WorkspaceContentService,
    WorkspaceChatService,
    { provide: WORKSPACE_REPOSITORY, useClass: PrismaWorkspaceRepository },
    { provide: WORKSPACE_OVERVIEW_REPOSITORY, useClass: PrismaWorkspaceOverviewRepository },
    { provide: WORKSPACE_CONTENT_REPOSITORY, useClass: PrismaWorkspaceContentRepository },
    { provide: WORKSPACE_CHAT_REPOSITORY, useClass: PrismaWorkspaceChatRepository },
  ],
})
export class WorkspaceModule {}

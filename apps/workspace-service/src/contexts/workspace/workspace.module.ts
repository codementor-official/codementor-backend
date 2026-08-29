import { Module } from '@nestjs/common';
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
import { AssignmentReminderScheduler } from './application/assignment-reminder.scheduler';
import { ASSIGNMENT_REMINDER_REPOSITORY } from './domain/port/assignment-reminder.repository';
import { PrismaAssignmentReminderRepository } from './infrastructure/prisma-assignment-reminder.repository';

@Module({
  controllers: [WorkspaceController],
  providers: [
    WorkspaceService,
    WorkspaceOverviewService,
    WorkspaceContentService,
    WorkspaceChatService,
    AssignmentReminderScheduler,
    { provide: WORKSPACE_REPOSITORY, useClass: PrismaWorkspaceRepository },
    { provide: WORKSPACE_OVERVIEW_REPOSITORY, useClass: PrismaWorkspaceOverviewRepository },
    { provide: WORKSPACE_CONTENT_REPOSITORY, useClass: PrismaWorkspaceContentRepository },
    { provide: WORKSPACE_CHAT_REPOSITORY, useClass: PrismaWorkspaceChatRepository },
    { provide: ASSIGNMENT_REMINDER_REPOSITORY, useClass: PrismaAssignmentReminderRepository },
  ],
})
export class WorkspaceModule {}

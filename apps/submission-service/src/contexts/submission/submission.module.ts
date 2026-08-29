import { Module } from '@nestjs/common';
import { CreateSubmissionUseCase, QuerySubmissionsUseCase } from './application/submission.usecases';
import { EXERCISE_GRADING_PORT, JUDGE_PORT, WORKSPACE_ASSIGNMENT_PORT } from './domain/grading.port';
import { SUBMISSION_REPOSITORY } from './domain/submission.repository';
import { HttpExerciseGradingClient, HttpJudgeClient, HttpWorkspaceAssignmentClient } from './infrastructure/http-grading.clients';
import { PrismaSubmissionRepository } from './infrastructure/prisma-submission.repository';
import { SubmissionController } from './presentation/submission.controller';

@Module({
  controllers: [SubmissionController],
  providers: [
    CreateSubmissionUseCase,
    QuerySubmissionsUseCase,
    { provide: SUBMISSION_REPOSITORY, useClass: PrismaSubmissionRepository },
    { provide: EXERCISE_GRADING_PORT, useClass: HttpExerciseGradingClient },
    { provide: JUDGE_PORT, useClass: HttpJudgeClient },
    { provide: WORKSPACE_ASSIGNMENT_PORT, useClass: HttpWorkspaceAssignmentClient },
  ],
})
export class SubmissionModule {}

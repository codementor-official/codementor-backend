import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { TOPICS, type TopicName } from '@codementor/contracts';
import { EVENT_BUS, type EventBus } from '@codementor/messaging';
import { requireHumanId, type AuthenticatedUser } from '@codementor/platform';
import {
  EXERCISE_GRADING_PORT,
  JUDGE_PORT,
  WORKSPACE_ASSIGNMENT_PORT,
  type ExerciseGradingPort,
  type JudgePort,
  type WorkspaceAssignmentPort,
} from '../domain/grading.port';
import type { SubmissionRecord } from '../domain/submission';
import {
  SUBMISSION_REPOSITORY,
  type SubmissionRepository,
} from '../domain/submission.repository';
import type { CreateSubmissionDto, ListMySubmissionsDto } from '../presentation/dto/submission.dto';

function view(record: SubmissionRecord, includeSource = false) {
  return {
    id: record.id,
    exerciseId: record.exerciseId,
    assignmentId: record.assignmentId,
    language: record.language,
    ...(includeSource ? { sourceCode: record.sourceCode } : {}),
    verdict: record.verdict,
    score: record.score,
    passedTests: record.passedTests,
    totalTests: record.totalTests,
    runtimeMs: record.runtimeMs,
    memoryKb: record.memoryKb,
    attemptNumber: record.attemptNumber,
    isLate: record.isLate,
    submittedAt: record.submittedAt.toISOString(),
  };
}

@Injectable()
export class CreateSubmissionUseCase {
  private readonly logger = new Logger(CreateSubmissionUseCase.name);

  constructor(
    @Inject(SUBMISSION_REPOSITORY) private readonly submissions: SubmissionRepository,
    @Inject(EXERCISE_GRADING_PORT) private readonly exercises: ExerciseGradingPort,
    @Inject(JUDGE_PORT) private readonly judge: JudgePort,
    @Inject(WORKSPACE_ASSIGNMENT_PORT) private readonly assignments: WorkspaceAssignmentPort,
    @Inject(EVENT_BUS) private readonly events: EventBus,
  ) {}

  async execute(user: AuthenticatedUser, dto: CreateSubmissionDto, authorization: string) {
    const userId = requireHumanId(user);
    if (!authorization) throw new BadRequestException('Thiếu access token');
    if (Boolean(dto.courseId) !== Boolean(dto.lessonId)) {
      throw new BadRequestException('courseId và lessonId phải cùng có hoặc cùng vắng mặt');
    }

    let isLate = false;
    if (dto.assignmentId) {
      const assignment = await this.assignments.getContext(dto.assignmentId, authorization);
      if (!assignment) throw new NotFoundException('Bài giao không tồn tại hoặc không thuộc về bạn');
      if (assignment.exerciseId !== dto.exerciseId) {
        throw new BadRequestException('Bài giao không thuộc bài tập đang nộp');
      }
      if (!assignment.allowRetry && assignment.submissionCount > 0) {
        throw new BadRequestException('Bài giao này không cho phép nộp lại');
      }
      if (assignment.attemptLimit !== null && assignment.submissionCount >= assignment.attemptLimit) {
        throw new BadRequestException('Bạn đã dùng hết số lần nộp cho phép');
      }
      if (assignment.dueAt) {
        isLate = new Date(assignment.dueAt).getTime() < Date.now();
        if (isLate && !assignment.allowLateSubmission) {
          throw new BadRequestException('Bài giao đã hết hạn nộp');
        }
      }
    }

    const snapshot = await this.exercises.getSnapshot(dto.exerciseId, authorization);
    if (!(snapshot.content.languages ?? []).some((language) => language.id === dto.language)) {
      throw new BadRequestException('Ngôn ngữ không được bài tập này hỗ trợ');
    }
    const testCases = snapshot.content.testCases ?? [];
    if (testCases.length === 0) throw new BadRequestException('Bài tập chưa có bộ test để chấm');

    const hadAccepted = await this.submissions.hasAccepted(userId, dto.exerciseId);
    const pending = await this.submissions.createPending({
      userId,
      exerciseId: dto.exerciseId,
      assignmentId: dto.assignmentId ?? null,
      language: dto.language,
      sourceCode: dto.sourceCode,
      isLate,
    });

    await this.publishBestEffort(TOPICS.SUBMISSION_CREATED, {
      submissionId: pending.id,
      userId,
      exerciseId: dto.exerciseId,
      assignmentId: dto.assignmentId ?? null,
      language: dto.language,
      attemptNumber: pending.attemptNumber,
    });

    const signature = snapshot.content.signature;
    const checker = snapshot.content.evaluation?.checker;
    const judgeResult = await this.judge.run({
      authorization,
      submissionId: pending.id,
      language: dto.language,
      sourceCode: dto.sourceCode,
      timeLimitMs: snapshot.timeLimitMs,
      memoryLimitKb: snapshot.memoryLimitKb,
      ...(snapshot.content.ioMode === 'function' && signature
        ? {
            spec: {
              functionName: signature.functionName,
              parameters: signature.parameters,
              returnType: signature.returnType,
              judgeMode: checker === 'float' || checker === 'unordered' ? checker : 'exact',
              ...(checker === 'float' && snapshot.content.evaluation?.floatTolerance
                ? {
                    judgeConfig: {
                      absEps: snapshot.content.evaluation.floatTolerance,
                      relEps: snapshot.content.evaluation.floatTolerance,
                    },
                  }
                : {}),
            },
          }
        : {}),
      testCases: testCases.map((testCase) => ({
        order: testCase.order,
        ...(testCase.args !== undefined
          ? { args: testCase.args }
          : { input: testCase.input ?? '' }),
        expected: testCase.expected,
        weight: testCase.weight ?? 1,
      })),
      ...(dto.courseId && dto.lessonId
        ? {
            context: {
              courseId: dto.courseId,
              lessonId: dto.lessonId,
              exerciseId: dto.exerciseId,
            },
          }
        : {}),
    });

    const completed = await this.submissions.complete(pending.id, judgeResult);
    await this.publishBestEffort(TOPICS.SUBMISSION_EVALUATED, {
      submissionId: completed.id,
      userId,
      exerciseId: completed.exerciseId,
      assignmentId: completed.assignmentId,
      accepted: completed.verdict === 'accepted',
      score: completed.score ?? 0,
      firstAccepted: completed.verdict === 'accepted' && !hadAccepted,
      xpAwarded: completed.verdict === 'accepted' && !hadAccepted ? snapshot.xpReward : 0,
    });

    return {
      ...view(completed, true),
      compileOutput: judgeResult.compileOutput ?? null,
      consoleOutput: judgeResult.consoleOutput ?? '',
      cases: judgeResult.cases,
    };
  }

  private async publishBestEffort(topic: TopicName, payload: unknown): Promise<void> {
    try {
      // TypeScript cannot retain the dependent topic/payload pair through this small helper.
      await this.events.publish(topic, payload as never);
    } catch (error) {
      this.logger.error(`Không phát được ${topic}; submission vẫn đã được lưu`, error as Error);
    }
  }
}

@Injectable()
export class QuerySubmissionsUseCase {
  constructor(@Inject(SUBMISSION_REPOSITORY) private readonly submissions: SubmissionRepository) {}

  async list(user: AuthenticatedUser, query: ListMySubmissionsDto) {
    const result = await this.submissions.listOwned(
      requireHumanId(user),
      query.exerciseId,
      query.page,
      query.limit,
    );
    return { ...result, items: result.items.map((item) => view(item)) };
  }

  async detail(user: AuthenticatedUser, id: string) {
    const result = await this.submissions.findOwned(id, requireHumanId(user));
    if (!result) throw new NotFoundException('Không tìm thấy bài nộp');
    return view(result, true);
  }
}

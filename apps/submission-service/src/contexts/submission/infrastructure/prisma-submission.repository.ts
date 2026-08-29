import { Injectable } from '@nestjs/common';
import { Prisma, type submissions } from '@prisma/client';
import { PrismaService } from '@codementor/platform';
import type { JudgeResult, SubmissionRecord, SubmissionVerdict } from '../domain/submission';
import type {
  CreateSubmissionInput,
  SubmissionPage,
  SubmissionRepository,
} from '../domain/submission.repository';

function toRecord(row: submissions): SubmissionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    exerciseId: row.exercise_id,
    assignmentId: row.assignment_id,
    language: row.language,
    sourceCode: row.source_code,
    verdict: row.verdict as SubmissionVerdict,
    score: row.score,
    passedTests: row.passed_tests,
    totalTests: row.total_tests,
    runtimeMs: row.runtime_ms,
    memoryKb: row.memory_kb,
    attemptNumber: row.attempt_number,
    isLate: row.is_late,
    runDetailRef: row.run_detail_ref,
    submittedAt: row.submitted_at,
  };
}

@Injectable()
export class PrismaSubmissionRepository implements SubmissionRepository {
  constructor(private readonly prisma: PrismaService) {}

  createPending(input: CreateSubmissionInput): Promise<SubmissionRecord> {
    return this.prisma.$transaction(
      async (tx) => {
        // Serialize attempt allocation for one learner/exercise pair. MAX()+1 without this
        // lock races when the user double-clicks Submit or has two tabs open.
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${`${input.userId}:${input.exerciseId}`}, 0))`;

        const aggregate = await tx.submissions.aggregate({
          where: { user_id: input.userId, exercise_id: input.exerciseId },
          _max: { attempt_number: true },
        });
        const row = await tx.submissions.create({
          data: {
            user_id: input.userId,
            exercise_id: input.exerciseId,
            assignment_id: input.assignmentId,
            language: input.language,
            source_code: input.sourceCode,
            is_late: input.isLate,
            attempt_number: (aggregate._max.attempt_number ?? 0) + 1,
          },
        });
        return toRecord(row);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async complete(id: string, result: JudgeResult): Promise<SubmissionRecord> {
    return toRecord(
      await this.prisma.submissions.update({
        where: { id },
        data: {
          verdict: result.verdict,
          score: result.score,
          passed_tests: result.passedTests,
          total_tests: result.totalTests,
          runtime_ms: result.runtimeMs,
          memory_kb: result.memoryKb,
          run_detail_ref: result.runDetailRef ?? null,
        },
      }),
    );
  }

  async findOwned(id: string, userId: string): Promise<SubmissionRecord | null> {
    const row = await this.prisma.submissions.findFirst({ where: { id, user_id: userId } });
    return row ? toRecord(row) : null;
  }

  async listOwned(
    userId: string,
    exerciseId: string | undefined,
    page: number,
    limit: number,
  ): Promise<SubmissionPage> {
    const where = { user_id: userId, ...(exerciseId ? { exercise_id: exerciseId } : {}) };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.submissions.findMany({
        where,
        orderBy: { submitted_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.submissions.count({ where }),
    ]);
    return {
      items: rows.map(toRecord),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async hasAccepted(userId: string, exerciseId: string): Promise<boolean> {
    return (
      (await this.prisma.submissions.count({
        where: { user_id: userId, exercise_id: exerciseId, verdict: 'accepted' },
      })) > 0
    );
  }
}

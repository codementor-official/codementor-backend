import { Injectable } from '@nestjs/common';
import { Prisma, type submissions } from '@prisma/client';
import { PrismaService } from '@codementor/platform';
import type { JudgeResult, SubmissionRecord, SubmissionVerdict } from '../domain/submission';
import { foldVerdictLanguage, type SubmissionStats, type VerdictLanguageRow } from '../domain/submission-stats';
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
  async adminStats(days: number): Promise<SubmissionStats> {
    // Mốc đầu cửa sổ = 00:00 giờ Việt Nam của (hôm nay − days + 1), để chuỗi theo ngày có
    // đúng `days` cột và cột đầu không bị cắt nửa ngày.
    const since = Prisma.sql`(date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh')
      - make_interval(days => ${days - 1}::int)) AT TIME ZONE 'Asia/Ho_Chi_Minh'`;

    const [groups, [percentiles], [stuck], daily] = await Promise.all([
      this.prisma.$queryRaw<VerdictLanguageRow[]>`
        SELECT language, verdict::text AS verdict, count(*)::int AS count,
               coalesce(sum(runtime_ms), 0)::int AS "runtimeSum",
               count(runtime_ms)::int AS "runtimeCount"
        FROM submissions WHERE submitted_at >= ${since}
        GROUP BY language, verdict`,
      this.prisma.$queryRaw<
        { rt50: number | null; rt95: number | null; mem50: number | null; mem95: number | null }[]
      >`
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY runtime_ms) AS rt50,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY runtime_ms) AS rt95,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY memory_kb) AS mem50,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY memory_kb) AS mem95
        FROM submissions WHERE submitted_at >= ${since} AND verdict <> 'pending'`,
      this.prisma.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count FROM submissions
        WHERE verdict = 'pending' AND submitted_at < now() - interval '5 minutes'`,
      this.prisma.$queryRaw<{ date: string; total: number; accepted: number }[]>`
        SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
               count(s.id)::int AS total,
               count(s.id) FILTER (WHERE s.verdict = 'accepted')::int AS accepted
        FROM generate_series(
               date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') - make_interval(days => ${days - 1}::int),
               date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh'),
               interval '1 day') AS d(day)
        LEFT JOIN submissions s
          ON date_trunc('day', s.submitted_at AT TIME ZONE 'Asia/Ho_Chi_Minh') = d.day
        GROUP BY d.day ORDER BY d.day`,
    ]);

    const round = (value: number | null) => (value === null ? null : Math.round(Number(value)));
    return {
      days,
      ...foldVerdictLanguage(groups),
      runtimeMs: { p50: round(percentiles.rt50), p95: round(percentiles.rt95) },
      memoryKb: { p50: round(percentiles.mem50), p95: round(percentiles.mem95) },
      stuckPending: stuck.count,
      daily,
    };
  }
}

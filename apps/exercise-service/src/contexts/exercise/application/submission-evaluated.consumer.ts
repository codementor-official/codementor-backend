import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TOPICS } from '@codementor/contracts';
import { EventConsumer } from '@codementor/messaging';
import { PrismaService } from '@codementor/platform';

/** Materializes submission results into the exercise-owned progress/cache tables. */
@Injectable()
export class SubmissionEvaluatedConsumer implements OnModuleInit {
  private readonly logger = new Logger(SubmissionEvaluatedConsumer.name);

  constructor(
    private readonly events: EventConsumer,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.events.on(TOPICS.SUBMISSION_EVALUATED, async (payload) => {
      const now = new Date();
      await this.prisma.$transaction(async (tx) => {
        const previous = await tx.exercise_progress.findUnique({
          where: {
            user_id_exercise_id: {
              user_id: payload.userId,
              exercise_id: payload.exerciseId,
            },
          },
        });
        const wasSolved = previous?.status === 'solved';
        const bestScore = Math.max(previous?.best_score ?? 0, payload.score);

        await tx.exercise_progress.upsert({
          where: {
            user_id_exercise_id: {
              user_id: payload.userId,
              exercise_id: payload.exerciseId,
            },
          },
          create: {
            user_id: payload.userId,
            exercise_id: payload.exerciseId,
            status: payload.accepted ? 'solved' : 'attempted',
            best_score: bestScore,
            attempt_count: 1,
            first_solved_at: payload.accepted ? now : null,
            last_attempt_at: now,
          },
          update: {
            status: payload.accepted || wasSolved ? 'solved' : 'attempted',
            best_score: bestScore,
            attempt_count: { increment: 1 },
            ...(!wasSolved && payload.accepted ? { first_solved_at: now } : {}),
            last_attempt_at: now,
          },
        });

        const solverIncrement = payload.accepted && !wasSolved ? 1 : 0;
        await tx.$executeRaw`
          UPDATE exercises
          SET attempt_count = attempt_count + 1,
              solver_count = solver_count + ${solverIncrement},
              acceptance_rate = ROUND(
                ((solver_count + ${solverIncrement})::numeric * 100) /
                GREATEST(attempt_count + 1, 1),
                2
              )
          WHERE id = ${payload.exerciseId}::uuid`;
      });
    });

    try {
      await this.events.start('exercise-service');
    } catch (cause) {
      this.logger.error(`Không đăng ký được consumer Kafka: ${String(cause)}`);
    }
  }
}

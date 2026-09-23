import { Module } from '@nestjs/common';
import { CreateExerciseUseCase } from './application/create-exercise.usecase';
import { DeleteExerciseUseCase } from './application/delete-exercise.usecase';
import { ForkExerciseUseCase } from './application/fork-exercise.usecase';
import { GetExerciseUseCase } from './application/get-exercise.usecase';
import { GetExerciseGradingUseCase } from './application/get-exercise-grading.usecase';
import { GetExerciseReferencesUseCase } from './application/get-exercise-references.usecase';
import { GetExerciseProgressSummaryUseCase } from './application/get-exercise-progress-summary.usecase';
import { ListExercisesUseCase } from './application/list-exercises.usecase';
import { ListExerciseTopicsUseCase } from './application/list-exercise-topics.usecase';
import { ModerateExerciseUseCase } from './application/moderate-exercise.usecase';
import { ReviewTransitionUseCase } from './application/review-transition.usecase';
import { SaveContentUseCase } from './application/save-content.usecase';
import { UpdateExerciseUseCase } from './application/update-exercise.usecase';
import { SubmissionEvaluatedConsumer } from './application/submission-evaluated.consumer';
import {
  EXERCISE_CONTENT_REPOSITORY,
  EXERCISE_REPOSITORY,
} from './domain/port/exercise.repository';
import { MongoExerciseContentRepository } from './infrastructure/mongo-exercise-content.repository';
import { PrismaExerciseRepository } from './infrastructure/prisma-exercise.repository';
import { ExerciseController } from './presentation/exercise.controller';
import { ExerciseSolutionsController } from './presentation/exercise-solutions.controller';

@Module({
  controllers: [ExerciseController, ExerciseSolutionsController],
  providers: [
    ListExercisesUseCase,
    ListExerciseTopicsUseCase,
    GetExerciseProgressSummaryUseCase,
    GetExerciseUseCase,
    GetExerciseGradingUseCase,
    GetExerciseReferencesUseCase,
    CreateExerciseUseCase,
    UpdateExerciseUseCase,
    SaveContentUseCase,
    DeleteExerciseUseCase,
    ForkExerciseUseCase,
    ReviewTransitionUseCase,
    ModerateExerciseUseCase,
    SubmissionEvaluatedConsumer,
    { provide: EXERCISE_REPOSITORY, useClass: PrismaExerciseRepository },
    { provide: EXERCISE_CONTENT_REPOSITORY, useClass: MongoExerciseContentRepository },
  ],
})
export class ExerciseModule {}

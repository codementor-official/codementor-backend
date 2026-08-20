import { Module } from '@nestjs/common';
import { CreateExerciseUseCase } from './application/create-exercise.usecase';
import { DeleteExerciseUseCase } from './application/delete-exercise.usecase';
import { ForkExerciseUseCase } from './application/fork-exercise.usecase';
import { GetExerciseUseCase } from './application/get-exercise.usecase';
import { GetExerciseReferencesUseCase } from './application/get-exercise-references.usecase';
import { ListExercisesUseCase } from './application/list-exercises.usecase';
import { ModerateExerciseUseCase } from './application/moderate-exercise.usecase';
import { ReviewTransitionUseCase } from './application/review-transition.usecase';
import { SaveContentUseCase } from './application/save-content.usecase';
import { UpdateExerciseUseCase } from './application/update-exercise.usecase';
import {
  EXERCISE_CONTENT_REPOSITORY,
  EXERCISE_REPOSITORY,
} from './domain/port/exercise.repository';
import { MongoExerciseContentRepository } from './infrastructure/mongo-exercise-content.repository';
import { PrismaExerciseRepository } from './infrastructure/prisma-exercise.repository';
import { ExerciseController } from './presentation/exercise.controller';

@Module({
  controllers: [ExerciseController],
  providers: [
    ListExercisesUseCase,
    GetExerciseUseCase,
    GetExerciseReferencesUseCase,
    CreateExerciseUseCase,
    UpdateExerciseUseCase,
    SaveContentUseCase,
    DeleteExerciseUseCase,
    ForkExerciseUseCase,
    ReviewTransitionUseCase,
    ModerateExerciseUseCase,
    { provide: EXERCISE_REPOSITORY, useClass: PrismaExerciseRepository },
    { provide: EXERCISE_CONTENT_REPOSITORY, useClass: MongoExerciseContentRepository },
  ],
})
export class ExerciseModule {}

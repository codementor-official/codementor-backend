import { Module } from '@nestjs/common';
import { CourseUseCases } from './application/course.usecases';
import { RoadmapUseCases } from './application/roadmap.usecases';
import { COURSE_REPOSITORY, LESSON_CONTENT_REPOSITORY } from './domain/port/course.repository';
import { ROADMAP_REPOSITORY } from './domain/port/roadmap.repository';
import { MongoLessonContentRepository } from './infrastructure/mongo-lesson-content.repository';
import { PrismaCourseRepository } from './infrastructure/prisma-course.repository';
import { PrismaRoadmapRepository } from './infrastructure/prisma-roadmap.repository';
import { CourseController } from './presentation/course.controller';
import { RoadmapController } from './presentation/roadmap.controller';

@Module({
  controllers: [RoadmapController, CourseController],
  providers: [
    RoadmapUseCases,
    CourseUseCases,
    { provide: ROADMAP_REPOSITORY, useClass: PrismaRoadmapRepository },
    { provide: COURSE_REPOSITORY, useClass: PrismaCourseRepository },
    { provide: LESSON_CONTENT_REPOSITORY, useClass: MongoLessonContentRepository },
  ],
})
export class LearningModule {}

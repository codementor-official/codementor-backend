import { Module } from '@nestjs/common';
import { ArticleUseCases } from './application/article.usecases';
import { CourseUseCases } from './application/course.usecases';
import { RoadmapUseCases } from './application/roadmap.usecases';
import { ARTICLE_CONTENT_REPOSITORY, ARTICLE_REPOSITORY } from './domain/port/article.repository';
import { COURSE_REPOSITORY, LESSON_CONTENT_REPOSITORY } from './domain/port/course.repository';
import { ROADMAP_REPOSITORY } from './domain/port/roadmap.repository';
import { MongoArticleContentRepository } from './infrastructure/mongo-article-content.repository';
import { MongoLessonContentRepository } from './infrastructure/mongo-lesson-content.repository';
import { PrismaArticleRepository } from './infrastructure/prisma-article.repository';
import { PrismaCourseRepository } from './infrastructure/prisma-course.repository';
import { PrismaRoadmapRepository } from './infrastructure/prisma-roadmap.repository';
import { ArticleController } from './presentation/article.controller';
import { CourseController } from './presentation/course.controller';
import { RoadmapController } from './presentation/roadmap.controller';

@Module({
  controllers: [RoadmapController, CourseController, ArticleController],
  providers: [
    RoadmapUseCases,
    CourseUseCases,
    ArticleUseCases,
    { provide: ROADMAP_REPOSITORY, useClass: PrismaRoadmapRepository },
    { provide: COURSE_REPOSITORY, useClass: PrismaCourseRepository },
    { provide: LESSON_CONTENT_REPOSITORY, useClass: MongoLessonContentRepository },
    { provide: ARTICLE_REPOSITORY, useClass: PrismaArticleRepository },
    { provide: ARTICLE_CONTENT_REPOSITORY, useClass: MongoArticleContentRepository },
  ],
})
export class LearningModule {}

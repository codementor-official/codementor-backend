import { Module } from '@nestjs/common';
import { RoadmapUseCases } from './application/roadmap.usecases';
import { ROADMAP_REPOSITORY } from './domain/port/roadmap.repository';
import { PrismaRoadmapRepository } from './infrastructure/prisma-roadmap.repository';
import { RoadmapController } from './presentation/roadmap.controller';

@Module({
  controllers: [RoadmapController],
  providers: [
    RoadmapUseCases,
    { provide: ROADMAP_REPOSITORY, useClass: PrismaRoadmapRepository },
  ],
})
export class LearningModule {}

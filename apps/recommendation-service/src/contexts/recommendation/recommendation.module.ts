import { Module } from '@nestjs/common';
import { CANDIDATE_REPOSITORY } from './domain/port/candidate.repository';
import { PrismaCandidateRepository } from './infrastructure/prisma-candidate.repository';
import { RecommendUseCase } from './application/recommend.usecase';
import { RecommendationController } from './presentation/recommendation.controller';

/**
 * Một context, ba loại nội dung, MỘT bộ luật chấm điểm (`domain/model/scoring.ts`). Thêm
 * loại nội dung mới = thêm một truy vấn trong repository và một route, không phải thêm
 * thuật toán.
 */
@Module({
  controllers: [RecommendationController],
  providers: [
    { provide: CANDIDATE_REPOSITORY, useClass: PrismaCandidateRepository },
    RecommendUseCase,
  ],
})
export class RecommendationModule {}

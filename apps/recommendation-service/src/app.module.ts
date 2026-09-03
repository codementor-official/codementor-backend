import { Module } from '@nestjs/common';
import {
  AuthModule,
  ConfigModule,
  HealthModule,
  HttpModule,
  LoggingModule,
  PrismaModule,
  RemoteIdentityModule,
} from '@codementor/platform';
import { RecommendationModule } from './contexts/recommendation/recommendation.module';

/**
 * recommendation-service
 *
 * Sở hữu 0 bảng. Chỉ ĐỌC: `learning_preferences`/`user_bookmarks` (core),
 * `roadmaps`/`courses`/`articles`/enrollment (learning), `exercises`/`exercise_progress`
 * (exercise), `study_groups`/`group_members` (workspace) — xem
 * `infrastructure/prisma-candidate.repository.ts`, mọi truy vấn đều là SELECT.
 *
 * Xếp hạng gồm hai phần cộng dồn: luật theo hồ sơ khai lúc onboarding, và content-based
 * (TF-IDF + cosine) theo lịch sử học đã có sẵn trong CSDL. Không thu thập hành vi MỚI —
 * không impression/click/feedback — nên vẫn không có `MessagingModule`: service không phát
 * và không nghe event nào, thêm Kafka vào đây là thêm một tiến trình nền không làm gì cả.
 *
 * Không có `MongoModule`: nội dung chi tiết bài học/bài tập nằm ở Mongo nhưng việc chấm
 * điểm chỉ cần metadata trong PostgreSQL.
 */
@Module({
  imports: [
    AuthModule,
    // Service này không sở hữu bảng `users`; phân giải `sub` của Keycloak sang
    // `users.id` bằng cách hỏi core-service qua HTTP.
    RemoteIdentityModule,
    ConfigModule,
    HealthModule,
    HttpModule,
    LoggingModule,
    PrismaModule,
    RecommendationModule,
  ],
})
export class AppModule {}

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
 * Sở hữu 0 bảng. Chỉ ĐỌC: `learning_preferences` (core), `roadmaps`/`courses`/enrollment
 * (learning), `exercises`/`exercise_progress` (exercise) — xem
 * `infrastructure/prisma-candidate.repository.ts`, mọi truy vấn đều là SELECT.
 *
 * Không có `MessagingModule`: yêu cầu hiện tại là đề xuất theo luật, KHÔNG thu thập hành vi
 * người dùng (không impression/click/feedback). Service này không phát và không nghe event
 * nào — thêm Kafka vào đây bây giờ là thêm một tiến trình nền không làm gì cả.
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

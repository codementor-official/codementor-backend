import { Module } from '@nestjs/common';
import { PublishAnnouncementUseCase } from './application/publish-announcement.usecase';
import { AnnouncementController } from './presentation/announcement.controller';

/** Không repository, không bảng: thông báo được lưu bởi notification-service. */
@Module({
  controllers: [AnnouncementController],
  providers: [PublishAnnouncementUseCase],
})
export class AnnouncementModule {}

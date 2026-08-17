import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '@codementor/platform';
import type { AuthenticatedUser } from '@codementor/platform';
import { PublishAnnouncementUseCase } from '../application/publish-announcement.usecase';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';

@ApiTags('announcements')
@ApiBearerAuth('access-token')
@Controller({ path: 'announcements', version: '1' })
export class AnnouncementController {
  constructor(private readonly announcements: PublishAnnouncementUseCase) {}

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Gửi thông báo tới toàn bộ người dùng' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAnnouncementDto) {
    return this.announcements.execute(user, dto);
  }
}

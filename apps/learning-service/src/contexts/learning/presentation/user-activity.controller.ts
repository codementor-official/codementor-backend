import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { CurrentUser, Roles } from '@codementor/platform';
import type { AuthenticatedUser } from '@codementor/platform';
import { UserActivityUseCases } from '../application/user-activity.usecases';
import { LearningDashboardService } from '../application/learning-dashboard.service';

export class ActivityQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class ActivityCalendarQueryDto {
  @ApiPropertyOptional({ minimum: 4, maximum: 52, default: 13 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(4)
  @Max(52)
  weeks?: number;
}

/**
 * Hoạt động học tập của một tài khoản.
 *
 * Đường dẫn `/activity/...` chứ không phải `/users/:id/activity`: Kong định tuyến theo
 * TIỀN TỐ, và `/api/v1/users` đã trỏ hết về core-service. Đặt dưới `/users` thì request
 * này không bao giờ tới được learning-service.
 */
@ApiTags('activity')
@ApiBearerAuth('access-token')
@Controller({ path: 'activity', version: '1' })
export class UserActivityController {
  constructor(private readonly activity: UserActivityUseCases, private readonly dashboard: LearningDashboardService) {}

  @Get('me/dashboard')
  @ApiOperation({ summary: 'My learning dashboard: enrollments, activity and recorded study time' })
  dashboardSummary(@CurrentUser() actor: AuthenticatedUser) {
    return this.dashboard.mine(actor);
  }

  @Get('me')
  @ApiOperation({ summary: 'Dòng thời gian học tập của chính tôi' })
  mine(@CurrentUser() actor: AuthenticatedUser, @Query() query: ActivityQueryDto) {
    return this.activity.mine(actor, query.limit);
  }

  @Get('me/calendar')
  @ApiOperation({ summary: 'Lịch đóng góp học tập theo ngày của chính tôi' })
  calendar(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ActivityCalendarQueryDto,
  ) {
    return this.activity.calendar(actor, query.weeks);
  }

  @Get('users/:id')
  @Roles('admin')
  @ApiOperation({ summary: 'Dòng thời gian học tập của một tài khoản' })
  forUser(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ActivityQueryDto,
  ) {
    return this.activity.forUser(actor, id, query.limit);
  }
}

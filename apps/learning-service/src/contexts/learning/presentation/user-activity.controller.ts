import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { CurrentUser, Roles } from '@codementor/platform';
import type { AuthenticatedUser } from '@codementor/platform';
import { UserActivityUseCases } from '../application/user-activity.usecases';

export class ActivityQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
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
  constructor(private readonly activity: UserActivityUseCases) {}

  @Get('me')
  @ApiOperation({ summary: 'Dòng thời gian học tập của chính tôi' })
  mine(@CurrentUser() actor: AuthenticatedUser, @Query() query: ActivityQueryDto) {
    return this.activity.mine(actor, query.limit);
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

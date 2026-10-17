import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CurrentUser, requireHumanId, Roles } from '@codementor/platform';
import type { AuthenticatedUser } from '@codementor/platform';
import {
  ContentReportService,
  REPORT_CATEGORIES,
  REPORT_STATUSES,
  REPORT_TARGET_TYPES,
  type ReportCategory,
  type ReportStatus,
  type ReportTargetType,
} from '../application/content-report.service';
import { ReportModerationService } from '../application/report-moderation.service';

class SubmitContentReportDto {
  @ApiProperty({ enum: REPORT_TARGET_TYPES })
  @IsIn(REPORT_TARGET_TYPES)
  targetType!: ReportTargetType;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  targetId!: string;

  @ApiPropertyOptional({ description: 'Slug hoặc đường dẫn ổn định giúp moderation mở nội dung' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  targetRef?: string;

  @ApiProperty({ enum: REPORT_CATEGORIES })
  @IsIn(REPORT_CATEGORIES)
  category!: ReportCategory;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

class ListMyReportsQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}

class ListAdminReportsQueryDto extends ListMyReportsQueryDto {
  @IsOptional() @IsIn(['PENDING', 'RESOLVED', 'REJECTED']) status?:
    'PENDING' | 'RESOLVED' | 'REJECTED';
  @IsOptional() @IsIn(REPORT_TARGET_TYPES) targetType?: ReportTargetType;
  @IsOptional() @IsIn(REPORT_CATEGORIES) category?: ReportCategory;
  @IsOptional() @IsString() @MaxLength(200) q?: string;
}

/** Mọi chiều đổi trạng thái đều cần lý do — nó là thứ duy nhất giải thích dòng lịch sử về sau. */
class ResolveContentReportDto {
  @IsIn(REPORT_STATUSES) status!: ReportStatus;
  @IsString() @IsNotEmpty() @MaxLength(1000) resolutionNote!: string;
}

class ModerationNoteDto {
  @IsString() @IsNotEmpty() @MaxLength(1000) note!: string;
}

@ApiTags('reports')
@ApiBearerAuth('access-token')
@Controller({ path: 'me/reports', version: '1' })
export class ContentReportController {
  constructor(private readonly reports: ContentReportService) {}

  @Post()
  @ApiOperation({ summary: 'Báo cáo nội dung; tạo hoặc đưa báo cáo cũ về trạng thái chờ xử lý' })
  submit(@CurrentUser() user: AuthenticatedUser, @Body() dto: SubmitContentReportDto) {
    return this.reports.submit(requireHumanId(user), dto);
  }

  @Get()
  @ApiOperation({ summary: 'Các báo cáo do tài khoản hiện tại gửi' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListMyReportsQueryDto) {
    return this.reports.list(requireHumanId(user), query.page, query.limit);
  }
}

@ApiTags('reports')
@ApiBearerAuth('access-token')
@Controller({ path: 'reports', version: '1' })
@Roles('admin')
export class AdminContentReportController {
  constructor(
    private readonly reports: ContentReportService,
    private readonly moderation: ReportModerationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Admin: hàng chờ báo cáo vi phạm, có lọc và phân trang' })
  list(@Query() query: ListAdminReportsQueryDto) {
    return this.reports.adminList(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Admin: chi tiết báo cáo, nội dung bị báo cáo, tác giả và lịch sử xử lý',
  })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.moderation.detail(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Admin: đổi trạng thái xử lý (ghi lịch sử, hoàn tác được)' })
  resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveContentReportDto,
  ) {
    return this.moderation.changeStatus(
      id,
      user,
      requireHumanId(user),
      dto.status,
      dto.resolutionNote.trim(),
    );
  }

  @Post(':id/sanctions')
  @ApiOperation({ summary: 'Admin: tạm khoá tài khoản tác giả của nội dung bị báo cáo' })
  suspendOwner(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModerationNoteDto,
  ) {
    return this.moderation.suspendOwner(id, user, requireHumanId(user), dto.note.trim());
  }

  @Post(':id/actions/:actionId/rollback')
  @ApiOperation({ summary: 'Admin: hoàn tác một thao tác trong lịch sử xử lý báo cáo' })
  rollback(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('actionId', ParseUUIDPipe) actionId: string,
    @Body() dto: ModerationNoteDto,
  ) {
    return this.moderation.rollback(id, actionId, user, requireHumanId(user), dto.note.trim());
  }
}

import { Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, requireHumanId, type AuthenticatedUser } from '@codementor/platform';
import { LearningReportService } from '../application/learning-report.service';
import { LearningReportQueryDto } from './dto/insights.dto';

/** Báo cáo học tập cho giảng viên (nội dung của mình) và admin (toàn nền tảng) — ADR 0005. */
@ApiTags('learning-reports')
@ApiBearerAuth('access-token')
@Controller({ path: 'learning-reports', version: '1' })
export class LearningReportController {
  constructor(private readonly reports: LearningReportService) {}

  @Get()
  @Roles('lecturer')
  @ApiOperation({ summary: 'Hoàn thành, học dở, ngưng học, chứng chỉ, bỏ qua thứ tự — theo khóa học và lộ trình' })
  get(@CurrentUser() user: AuthenticatedUser, @Query() query: LearningReportQueryDto) {
    if (query.scope === 'all' && user.role !== 'admin') {
      throw new ForbiddenException('Chỉ admin xem được báo cáo toàn nền tảng');
    }
    return this.reports.get(query.scope === 'all' ? null : requireHumanId(user), query.days);
  }
}

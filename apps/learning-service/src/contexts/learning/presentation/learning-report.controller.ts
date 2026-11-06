import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '@codementor/platform';
import { LearningReportService } from '../application/learning-report.service';
import { InsightsQueryDto } from './dto/insights.dto';

/** Báo cáo học tập toàn nền tảng, chỉ admin (ADR 0005). Giảng viên xem số của mình ở dashboard. */
@ApiTags('learning-reports')
@ApiBearerAuth('access-token')
@Controller({ path: 'learning-reports', version: '1' })
export class LearningReportController {
  constructor(private readonly reports: LearningReportService) {}

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'Hoàn thành, học dở, ngưng học, chứng chỉ, bỏ qua thứ tự — theo khóa học và lộ trình' })
  get(@Query() query: InsightsQueryDto) {
    return this.reports.get(null, query.days);
  }
}

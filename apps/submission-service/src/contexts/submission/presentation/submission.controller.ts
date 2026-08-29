import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '@codementor/platform';
import { CreateSubmissionUseCase, QuerySubmissionsUseCase } from '../application/submission.usecases';
import { CreateSubmissionDto, ListMySubmissionsDto } from './dto/submission.dto';

@ApiTags('submissions')
@ApiBearerAuth('access-token')
@Controller({ path: 'submissions', version: '1' })
export class SubmissionController {
  constructor(
    private readonly createSubmission: CreateSubmissionUseCase,
    private readonly querySubmissions: QuerySubmissionsUseCase,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Nộp bài, chấm bằng bộ test phía server và lưu lịch sử' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('authorization') authorization: string,
    @Body() dto: CreateSubmissionDto,
  ) {
    return this.createSubmission.execute(user, dto, authorization);
  }

  @Get('mine')
  @ApiOperation({ summary: 'Lịch sử bài nộp của người đang đăng nhập' })
  mine(@CurrentUser() user: AuthenticatedUser, @Query() query: ListMySubmissionsDto) {
    return this.querySubmissions.list(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết bài nộp của chính người đang đăng nhập' })
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.querySubmissions.detail(user, id);
  }
}

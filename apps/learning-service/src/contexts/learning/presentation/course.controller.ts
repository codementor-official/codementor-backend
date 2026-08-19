import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, requireHumanId } from '@codementor/platform';
import type { AuthenticatedUser } from '@codementor/platform';
import { CourseUseCases } from '../application/course.usecases';
import { EnrollmentUseCases } from '../application/enrollment.usecases';
import {
  CreateCourseDto,
  ListCoursesQueryDto,
  SaveCurriculumDto,
  SaveLessonContentDto,
  UpdateCourseDto,
} from './dto/course.dto';
import { ModerateDto } from './dto/moderate.dto';
import { EnrollDto, RecordProgressDto } from './dto/enrollment.dto';

@ApiTags('courses')
@ApiBearerAuth('access-token')
@Controller({ path: 'courses', version: '1' })
export class CourseController {
  constructor(
    private readonly courses: CourseUseCases,
    private readonly enrollments: EnrollmentUseCases,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Danh mục khóa học đã công khai' })
  catalogue(@Query() query: ListCoursesQueryDto) {
    return this.courses.list({ publishedOnly: true }, query);
  }

  @Get('mine')
  @Roles('lecturer')
  @ApiOperation({ summary: 'Khóa học của tôi, mọi trạng thái' })
  mine(@CurrentUser() user: AuthenticatedUser, @Query() query: ListCoursesQueryDto) {
    return this.courses.list({ createdBy: requireHumanId(user) }, query);
  }

  @Get('moderation')
  @Roles('admin')
  @ApiOperation({ summary: 'Hàng chờ duyệt, cũ trước. `?status=` để tìm nội dung đã quyết định' })
  queue(@Query() query: ListCoursesQueryDto) {
    return this.courses.list({ pendingOnly: true }, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết, kèm cả cây chương và bài' })
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.courses.get(user, id);
  }

  @Post(':id/enroll')
  @ApiOperation({ summary: 'Ghi danh vào khóa học đã công khai' })
  @ApiResponse({ status: 422, description: 'Khóa học chưa công khai' })
  enroll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnrollDto,
  ) {
    return this.enrollments.enroll(user, id, dto.viaRoadmapId ?? null);
  }

  @Delete(':id/enroll')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Bỏ học — tiến độ vẫn giữ, quay lại là học tiếp' })
  unenroll(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.enrollments.drop(user, id);
  }

  @Get(':id/progress')
  @ApiOperation({ summary: 'Tiến độ của tôi: ghi danh + trạng thái từng bài + bài nào đã mở' })
  progress(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.enrollments.courseProgress(user, id);
  }

  // Dưới `:id` cho khớp `:id/lessons/:lessonId/content` — cùng một tài nguyên thì cùng
  // một hình dạng đường dẫn. `:id` không được dùng để tra cứu: use case tự tìm khóa học
  // từ bài, nên một id khóa học sai trong URL không mở được tiến độ của khóa khác.
  @Put(':id/lessons/:lessonId/progress')
  @ApiOperation({ summary: 'Ghi tiến độ một bài học' })
  @ApiResponse({ status: 403, description: 'Chưa ghi danh khóa học chứa bài này' })
  @ApiResponse({ status: 422, description: 'Bài chưa mở theo thứ tự học' })
  recordProgress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() dto: RecordProgressDto,
  ) {
    return this.enrollments.recordLessonProgress(user, lessonId, dto);
  }

  @Post()
  @Roles('lecturer')
  @ApiOperation({ summary: 'Tạo khóa học, luôn ở draft' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCourseDto) {
    return this.courses.create(user, dto);
  }

  @Patch(':id')
  @Roles('lecturer')
  @ApiOperation({ summary: 'Sửa metadata' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCourseDto,
  ) {
    return this.courses.update(user, id, dto);
  }

  @Put(':id/curriculum')
  @Roles('lecturer')
  @ApiOperation({ summary: 'Ghi cả cây chương + bài trong một transaction' })
  @ApiResponse({ status: 422, description: 'Một bài code bị thêm hai lần vào cùng một chương' })
  saveCurriculum(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveCurriculumDto,
  ) {
    return this.courses.saveCurriculum(
      user,
      id,
      dto.chapters.map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        description: chapter.description ?? null,
        isOptional: chapter.isOptional ?? false,
        lessons: chapter.lessons.map((lesson) => ({
          id: lesson.id,
          title: lesson.title,
          type: lesson.type,
          durationMinutes: lesson.durationMinutes ?? null,
          isPreview: lesson.isPreview ?? false,
          isOptional: lesson.isOptional ?? false,
          exerciseId: lesson.exerciseId ?? null,
        })),
      })),
    );
  }

  @Get(':id/lessons/:lessonId/content')
  @ApiOperation({ summary: 'Thân bài lý thuyết' })
  lessonContent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
  ) {
    return this.courses.getLessonContent(user, id, lessonId);
  }

  @Put(':id/lessons/:lessonId/content')
  @Roles('lecturer')
  @ApiOperation({ summary: 'Ghi thân bài lý thuyết xuống MongoDB' })
  saveLessonContent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() dto: SaveLessonContentDto,
  ) {
    return this.courses.saveLessonContent(user, id, lessonId, dto);
  }

  @Post(':id/submit')
  @Roles('lecturer')
  @ApiOperation({ summary: 'Gửi duyệt' })
  submit(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.courses.submit(user, id);
  }

  @Post(':id/moderate')
  @Roles('admin')
  @ApiOperation({ summary: 'Duyệt, yêu cầu sửa, từ chối hoặc gỡ khóa học' })
  @ApiResponse({ status: 400, description: 'Từ chối mà không nêu lý do' })
  decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModerateDto,
  ) {
    return this.courses.moderate(user, id, dto.decision, dto.reason ?? null);
  }

  @Post(':id/withdraw')
  @Roles('lecturer')
  @ApiOperation({ summary: 'Hủy gửi duyệt' })
  withdraw(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.courses.withdraw(user, id);
  }

  @Delete(':id')
  @Roles('lecturer')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Xoá khóa học chưa công khai' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.courses.remove(user, id);
  }
}

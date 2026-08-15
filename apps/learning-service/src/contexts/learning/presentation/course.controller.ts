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
import { CurrentUser, Roles } from '@codementor/platform';
import type { AuthenticatedUser } from '@codementor/platform';
import { CourseUseCases } from '../application/course.usecases';
import {
  CreateCourseDto,
  ListCoursesQueryDto,
  SaveCurriculumDto,
  SaveLessonContentDto,
  UpdateCourseDto,
} from './dto/course.dto';

@ApiTags('courses')
@ApiBearerAuth('access-token')
@Controller({ path: 'courses', version: '1' })
export class CourseController {
  constructor(private readonly courses: CourseUseCases) {}

  @Get()
  @ApiOperation({ summary: 'Danh mục khóa học đã công khai' })
  catalogue(@Query() query: ListCoursesQueryDto) {
    return this.courses.list({ publishedOnly: true }, query);
  }

  @Get('mine')
  @Roles('lecturer')
  @ApiOperation({ summary: 'Khóa học của tôi, mọi trạng thái' })
  mine(@CurrentUser() user: AuthenticatedUser, @Query() query: ListCoursesQueryDto) {
    return this.courses.list({ createdBy: user.id }, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết, kèm cả cây chương và bài' })
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.courses.get(user, id);
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

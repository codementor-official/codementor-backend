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
import { RoadmapUseCases } from '../application/roadmap.usecases';
import {
  CreateRoadmapDto,
  ListRoadmapsQueryDto,
  ReplaceRoadmapCoursesDto,
  UpdateRoadmapDto,
} from './dto/roadmap.dto';

@ApiTags('roadmaps')
@ApiBearerAuth('access-token')
@Controller({ path: 'roadmaps', version: '1' })
export class RoadmapController {
  constructor(private readonly roadmaps: RoadmapUseCases) {}

  @Get()
  @ApiOperation({ summary: 'Danh mục lộ trình đã công khai' })
  catalogue(@Query() query: ListRoadmapsQueryDto) {
    return this.roadmaps.list({ publishedOnly: true }, query);
  }

  @Get('mine')
  @Roles('lecturer')
  @ApiOperation({ summary: 'Lộ trình của tôi, mọi trạng thái' })
  mine(@CurrentUser() user: AuthenticatedUser, @Query() query: ListRoadmapsQueryDto) {
    return this.roadmaps.list({ createdBy: user.id }, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết, kèm danh sách khóa học đã sắp thứ tự' })
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.roadmaps.get(user, id);
  }

  @Post()
  @Roles('lecturer')
  @ApiOperation({ summary: 'Tạo lộ trình, luôn ở draft' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateRoadmapDto) {
    return this.roadmaps.create(user, dto);
  }

  @Patch(':id')
  @Roles('lecturer')
  @ApiOperation({ summary: 'Sửa metadata' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoadmapDto,
  ) {
    return this.roadmaps.update(user, id, dto);
  }

  @Put(':id/courses')
  @Roles('lecturer')
  @ApiOperation({ summary: 'Ghi lại cả danh sách khóa học và tính lại tổng thời lượng' })
  @ApiResponse({ status: 409, description: 'Một khóa học xuất hiện hai lần' })
  replaceCourses(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceRoadmapCoursesDto,
  ) {
    return this.roadmaps.replaceCourses(
      user,
      id,
      dto.courses.map((course) => ({ courseId: course.courseId, isOptional: course.isOptional ?? false })),
    );
  }

  @Post(':id/submit')
  @Roles('lecturer')
  @ApiOperation({ summary: 'Gửi duyệt' })
  submit(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.roadmaps.submit(user, id);
  }

  @Post(':id/withdraw')
  @Roles('lecturer')
  @ApiOperation({ summary: 'Hủy gửi duyệt' })
  withdraw(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.roadmaps.withdraw(user, id);
  }

  @Delete(':id')
  @Roles('lecturer')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Xoá lộ trình chưa công khai' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.roadmaps.remove(user, id);
  }
}

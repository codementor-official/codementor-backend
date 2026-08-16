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
import { CreateExerciseUseCase } from '../application/create-exercise.usecase';
import { DeleteExerciseUseCase } from '../application/delete-exercise.usecase';
import { ForkExerciseUseCase } from '../application/fork-exercise.usecase';
import { GetExerciseUseCase } from '../application/get-exercise.usecase';
import { ListExercisesUseCase } from '../application/list-exercises.usecase';
import { ModerateExerciseUseCase } from '../application/moderate-exercise.usecase';
import { ReviewTransitionUseCase } from '../application/review-transition.usecase';
import { SaveContentUseCase } from '../application/save-content.usecase';
import { UpdateExerciseUseCase } from '../application/update-exercise.usecase';
import {
  CreateExerciseDto,
  ModerateDto,
  SaveContentDto,
  UpdateExerciseDto,
} from './dto/exercise.dto';
import { ListExercisesQueryDto } from './dto/list-exercises.query';

/**
 * Hai phạm vi đọc, cố ý là hai đường dẫn khác nhau:
 *
 *   GET /exercises        kho chung — chỉ bài `public` + `published`, mọi tác giả
 *   GET /exercises/mine   bài của tôi — mọi trạng thái, chỉ của tôi
 *
 * Gộp thành một endpoint kèm `?scope=` thì phạm vi dữ liệu phụ thuộc một tham số truy
 * vấn, và quên truyền nó là lộ toàn bộ bản nháp của mọi người.
 */
@ApiTags('exercises')
@ApiBearerAuth('access-token')
@Controller({ path: 'exercises', version: '1' })
export class ExerciseController {
  constructor(
    private readonly listExercises: ListExercisesUseCase,
    private readonly getExercise: GetExerciseUseCase,
    private readonly createExercise: CreateExerciseUseCase,
    private readonly updateExercise: UpdateExerciseUseCase,
    private readonly saveContent: SaveContentUseCase,
    private readonly deleteExercise: DeleteExerciseUseCase,
    private readonly forkExercise: ForkExerciseUseCase,
    private readonly review: ReviewTransitionUseCase,
    private readonly moderate: ModerateExerciseUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Kho bài chung — public và đã công khai' })
  bank(@Query() query: ListExercisesQueryDto) {
    return this.listExercises.execute({ publishedOnly: true }, query);
  }

  @Get('mine')
  @Roles('lecturer')
  @ApiOperation({ summary: 'Bài của tôi, mọi trạng thái' })
  mine(@CurrentUser() user: AuthenticatedUser, @Query() query: ListExercisesQueryDto) {
    return this.listExercises.execute({ authorId: requireHumanId(user) }, query);
  }

  @Get('moderation')
  @Roles('admin')
  @ApiOperation({ summary: 'Hàng chờ duyệt, cũ trước' })
  queue(@Query() query: ListExercisesQueryDto) {
    return this.listExercises.execute({ pendingOnly: true }, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết, gồm cả thân bài' })
  @ApiResponse({ status: 404, description: 'Không tồn tại hoặc không có quyền xem' })
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.getExercise.execute(user, id);
  }

  @Post()
  @Roles('lecturer')
  @ApiOperation({ summary: 'Tạo bài mới, luôn ở draft' })
  @ApiResponse({ status: 409, description: 'Slug đã tồn tại' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateExerciseDto) {
    return this.createExercise.execute(user, dto);
  }

  @Patch(':id')
  @Roles('lecturer')
  @ApiOperation({ summary: 'Sửa metadata' })
  @ApiResponse({ status: 422, description: 'Bài đang chờ duyệt' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExerciseDto,
  ) {
    return this.updateExercise.execute(user, id, dto);
  }

  @Put(':id/content')
  @Roles('lecturer')
  @ApiOperation({ summary: 'Ghi thân bài xuống MongoDB' })
  content(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveContentDto,
  ) {
    return this.saveContent.execute(user, id, dto);
  }

  @Delete(':id')
  @Roles('lecturer')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Xoá bài' })
  @ApiResponse({ status: 409, description: 'Còn chương đang tham chiếu' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.deleteExercise.execute(user, id);
  }

  @Post(':id/fork')
  @Roles('lecturer')
  @ApiOperation({ summary: 'Tạo bản sao độc lập, luôn ở draft' })
  @ApiResponse({ status: 403, description: 'Bài chưa công khai, hoặc là bài của chính mình' })
  fork(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.forkExercise.execute(user, id);
  }

  @Post(':id/submit')
  @Roles('lecturer')
  @ApiOperation({ summary: 'Gửi duyệt' })
  submit(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.review.submit(user, id);
  }

  @Post(':id/moderate')
  @Roles('admin')
  @ApiOperation({ summary: 'Duyệt, yêu cầu sửa, từ chối hoặc gỡ' })
  @ApiResponse({ status: 400, description: 'Từ chối mà không nêu lý do' })
  @ApiResponse({ status: 422, description: 'Bài không ở trạng thái cho phép quyết định đó' })
  decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModerateDto,
  ) {
    return this.moderate.execute(user, id, dto.decision, dto.reason ?? null);
  }

  @Post(':id/withdraw')
  @Roles('lecturer')
  @ApiOperation({ summary: 'Hủy gửi duyệt, về draft để sửa tiếp' })
  withdraw(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.review.withdraw(user, id);
  }
}

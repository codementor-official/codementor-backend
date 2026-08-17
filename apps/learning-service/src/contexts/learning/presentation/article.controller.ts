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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '@codementor/platform';
import type { AuthenticatedUser } from '@codementor/platform';
import { ArticleUseCases } from '../application/article.usecases';
import {
  CreateArticleDto,
  ListArticlesQueryDto,
  ModerateArticleDto,
  SaveArticleContentDto,
  UpdateArticleDto,
} from './dto/article.dto';

/**
 * Bài viết biên tập. Hai nhóm đường dẫn trong cùng một controller:
 *
 *  - đọc (`GET /articles`, `GET /articles/:slug`) — dành cho người học, chỉ bài công khai;
 *  - quản trị (`/articles/manage/...`) — `@Roles('admin', 'lecturer')`, mọi trạng thái.
 *
 * Tiền tố `manage` chứ không phải một controller `/admin/articles` riêng: Kong định
 * tuyến theo tiền tố đường dẫn, và thêm một tiền tố mới là thêm một route ở gateway.
 */
@ApiTags('articles')
@ApiBearerAuth('access-token')
@Controller({ path: 'articles', version: '1' })
export class ArticleController {
  constructor(private readonly articles: ArticleUseCases) {}

  @Get()
  @ApiOperation({ summary: 'Danh mục bài viết đã công khai' })
  catalogue(@Query() query: ListArticlesQueryDto) {
    return this.articles.catalogue(query);
  }

  @Get('tags')
  @ApiOperation({ summary: 'Chủ đề của các bài đã công khai, kèm số bài' })
  tags() {
    return this.articles.tags();
  }

  // Đặt TRƯỚC `:slug`: Nest khớp route theo thứ tự khai báo, để sau thì "manage" sẽ bị
  // hiểu là slug của một bài viết.
  @Get('manage')
  @Roles('admin', 'lecturer')
  @ApiOperation({ summary: 'Danh sách soạn thảo. Giảng viên chỉ thấy bài của mình.' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListArticlesQueryDto) {
    return this.articles.list(user, query);
  }

  @Get('manage/moderation')
  @Roles('admin')
  @ApiOperation({ summary: 'Hàng chờ duyệt bài viết' })
  queue(@CurrentUser() user: AuthenticatedUser, @Query() query: ListArticlesQueryDto) {
    return this.articles.moderationQueue(user, query);
  }

  @Get('manage/summary')
  @Roles('admin', 'lecturer')
  @ApiOperation({ summary: 'Đếm bài viết theo trạng thái' })
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.articles.countByStatus(user);
  }

  @Get('manage/:id')
  @Roles('admin', 'lecturer')
  @ApiOperation({ summary: 'Chi tiết kèm thân bài, để sửa' })
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.articles.get(user, id);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Đọc một bài viết. Bài chưa công khai chỉ admin xem được.' })
  read(@CurrentUser() user: AuthenticatedUser, @Param('slug') slug: string) {
    return this.articles.getBySlug(user, slug);
  }

  @Post()
  @Roles('admin', 'lecturer')
  @ApiOperation({ summary: 'Tạo bản nháp bài viết' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateArticleDto) {
    return this.articles.create(user, dto);
  }

  @Patch(':id')
  @Roles('admin', 'lecturer')
  @ApiOperation({ summary: 'Sửa thông tin bài viết' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateArticleDto,
  ) {
    return this.articles.update(user, id, dto);
  }

  @Put(':id/content')
  @Roles('admin', 'lecturer')
  @ApiOperation({ summary: 'Ghi thân bài' })
  saveContent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveArticleContentDto,
  ) {
    return this.articles.saveContent(user, id, dto.contentHtml);
  }

  @Post(':id/submit')
  @Roles('admin', 'lecturer')
  @ApiOperation({ summary: 'Gửi bài đi duyệt' })
  submit(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.articles.submit(user, id);
  }

  @Post(':id/withdraw')
  @Roles('admin', 'lecturer')
  @ApiOperation({ summary: 'Rút bài khỏi hàng chờ duyệt' })
  withdraw(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.articles.withdraw(user, id);
  }

  @Post(':id/moderate')
  @Roles('admin')
  @ApiOperation({ summary: 'Duyệt bài. Lần công khai đầu tiên phát evt.article.published.v1.' })
  moderate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModerateArticleDto,
  ) {
    return this.articles.moderate(user, id, dto.decision, dto.reason ?? null);
  }

  @Post(':id/archive')
  @Roles('admin', 'lecturer')
  @ApiOperation({ summary: 'Lưu trữ bài viết' })
  archive(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.articles.archive(user, id);
  }

  @Delete(':id')
  @Roles('admin', 'lecturer')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Xoá hẳn. Chỉ với bài chưa từng công khai.' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.articles.remove(user, id);
  }
}

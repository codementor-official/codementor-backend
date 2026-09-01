import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, requireHumanId } from '@codementor/platform';
import type { AuthenticatedUser } from '@codementor/platform';
import { RecommendUseCase } from '../application/recommend.usecase';
import {
  ListRecommendationsQuery,
  NextExerciseQuery,
  RelatedArticlesQuery,
} from './dto/list-recommendations.query';

const DEFAULT_LIMIT = 6;

/**
 * Đề xuất theo luật, dựa trên hồ sơ cá nhân hóa (`learning_preferences`) và metadata nội
 * dung. Không ghi gì, không nhận sự kiện tương tác nào — yêu cầu hiện tại là content-based
 * thuần, không thu thập hành vi.
 *
 * `userId` LUÔN lấy từ token; không route nào ở đây nhận id người dùng qua query hay body.
 */
@ApiTags('recommendations')
@ApiBearerAuth('access-token')
@Controller({ path: 'recommendations', version: '1' })
export class RecommendationController {
  constructor(private readonly recommend: RecommendUseCase) {}

  @Get('roadmaps')
  @ApiOperation({ summary: 'Lộ trình đề xuất, điểm khớp cao nhất trước' })
  roadmaps(@CurrentUser() user: AuthenticatedUser, @Query() query: ListRecommendationsQuery) {
    return this.recommend.roadmaps(requireHumanId(user), query.limit ?? DEFAULT_LIMIT);
  }

  @Get('courses')
  @ApiOperation({ summary: 'Khóa học đề xuất, điểm khớp cao nhất trước' })
  courses(@CurrentUser() user: AuthenticatedUser, @Query() query: ListRecommendationsQuery) {
    return this.recommend.courses(requireHumanId(user), query.limit ?? DEFAULT_LIMIT);
  }

  @Get('exercises')
  @ApiOperation({ summary: 'Bài luyện tập đề xuất, điểm khớp cao nhất trước' })
  exercises(@CurrentUser() user: AuthenticatedUser, @Query() query: ListRecommendationsQuery) {
    return this.recommend.exercises(requireHumanId(user), query.limit ?? DEFAULT_LIMIT);
  }

  @Get('articles')
  @ApiOperation({ summary: 'Bài viết đề xuất, điểm khớp cao nhất trước' })
  articles(@CurrentUser() user: AuthenticatedUser, @Query() query: ListRecommendationsQuery) {
    return this.recommend.articles(requireHumanId(user), query.limit ?? DEFAULT_LIMIT);
  }

  // Trước `:kind` nào cũng vậy — nhưng ở đây quan trọng hơn: `articles/related` phải đứng
  // sau `articles` và không được để route nào bắt `articles/*` chen vào giữa.
  @Get('articles/related')
  @ApiOperation({ summary: 'Bài viết liên quan bài đang đọc' })
  relatedArticles(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: RelatedArticlesQuery,
  ) {
    return this.recommend.relatedArticles(
      requireHumanId(user),
      query.articleId,
      query.limit ?? DEFAULT_LIMIT,
    );
  }

  @Get('groups')
  @ApiOperation({ summary: 'Nhóm học tập công khai đề xuất, điểm khớp cao nhất trước' })
  groups(@CurrentUser() user: AuthenticatedUser, @Query() query: ListRecommendationsQuery) {
    return this.recommend.groups(requireHumanId(user), query.limit ?? DEFAULT_LIMIT);
  }

  // Route cụ thể phải đứng TRƯỚC route chung cùng tiền tố nếu sau này `exercises` nhận
  // tham số đường dẫn; giữ thứ tự này để khỏi phải nhớ lại lúc đó.
  @Get('exercises/next')
  @ApiOperation({ summary: 'Một bài kế tiếp sau khi vừa nộp đạt (top-1)' })
  next(@CurrentUser() user: AuthenticatedUser, @Query() query: NextExerciseQuery) {
    return this.recommend.nextExercise(requireHumanId(user), query.exerciseId);
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { CurrentUser, PrismaService, requireHumanId } from '@codementor/platform';
import type { AuthenticatedUser } from '@codementor/platform';

type SolutionInput = { title?: unknown; explanation?: unknown; code?: unknown; language?: unknown };
type CommentInput = { body?: unknown };

/** Only published, public code problems have a global solutions community. */
@ApiTags('exercise-solutions')
@ApiBearerAuth('access-token')
@Controller({ path: 'exercises/:exerciseId/solutions', version: '1' })
export class ExerciseSolutionsController {
  constructor(private readonly prisma: PrismaService) {}

  private async publicExercise(exerciseId: string) {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM exercises WHERE id = ${exerciseId}::uuid
        AND visibility = 'public' AND status = 'published' AND kind = 'code' LIMIT 1`;
    if (!rows.length) throw new NotFoundException('Không tìm thấy bài luyện tập công khai');
  }

  private async solution(exerciseId: string, solutionId: string) {
    await this.publicExercise(exerciseId);
    const rows = await this.prisma.$queryRaw<{ id: string; author_id: string }[]>`
      SELECT id, author_id FROM exercise_solutions WHERE id = ${solutionId}::uuid
        AND exercise_id = ${exerciseId}::uuid AND deleted_at IS NULL LIMIT 1`;
    if (!rows.length) throw new NotFoundException('Không tìm thấy lời giải');
    return rows[0];
  }

  private text(value: unknown, name: string, min: number, max: number) {
    if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
      throw new BadRequestException(`${name} phải có ${min}–${max} ký tự`);
    }
    return value.trim();
  }

  private fields(body: SolutionInput) {
    const title = this.text(body.title, 'Tiêu đề', 3, 160);
    const explanation = this.text(body.explanation, 'Giải thích', 10, 20000);
    const code =
      body.code == null || body.code === '' ? null : this.text(body.code, 'Code', 1, 30000);
    const language =
      body.language == null || body.language === ''
        ? null
        : this.text(body.language, 'Ngôn ngữ', 1, 40);
    return { title, explanation, code, language };
  }

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('exerciseId', ParseUUIDPipe) exerciseId: string,
    @Query('page') rawPage?: string,
    @Query('sort') rawSort?: string,
    @Query('q') rawQuery?: string,
    @Query('language') rawLanguage?: string,
  ) {
    await this.publicExercise(exerciseId);
    const viewerId = requireHumanId(user);
    const page = rawPage === undefined ? 1 : Number(rawPage);
    if (!Number.isInteger(page) || page < 1 || page > 10000)
      throw new BadRequestException('Trang không hợp lệ');
    const sort = rawSort ?? 'newest';
    if (!['newest', 'popular'].includes(sort))
      throw new BadRequestException('Sắp xếp không hợp lệ');
    const q = rawQuery?.trim() ?? '';
    const language = rawLanguage?.trim() ?? '';
    if (q.length > 100 || language.length > 40)
      throw new BadRequestException('Bộ lọc lời giải quá dài');
    const filter = Prisma.sql`
      s.exercise_id = ${exerciseId}::uuid AND s.deleted_at IS NULL
      AND (${q} = '' OR strpos(lower(s.title), lower(${q})) > 0
        OR strpos(lower(s.explanation), lower(${q})) > 0)
      AND (${language} = '' OR lower(s.language) = lower(${language}))`;
    const order =
      sort === 'popular'
        ? Prisma.sql`"voteCount" DESC, s.created_at DESC, s.id DESC`
        : Prisma.sql`s.created_at DESC, s.id DESC`;
    const [rows, totals, languages] = await Promise.all([
      this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT s.id, s.title, s.explanation, s.code, s.language,
        s.author_id AS "authorId", u.display_name AS "authorName", u.avatar_url AS "authorAvatar",
        s.created_at AS "createdAt", s.updated_at AS "updatedAt",
        (SELECT count(*)::int FROM exercise_solution_votes v WHERE v.solution_id = s.id) AS "voteCount",
        (SELECT count(*)::int FROM exercise_solution_comments c WHERE c.solution_id = s.id AND c.deleted_at IS NULL) AS "commentCount",
        EXISTS(SELECT 1 FROM exercise_solution_votes v WHERE v.solution_id = s.id AND v.user_id = ${viewerId}::uuid) AS "votedByMe"
      FROM exercise_solutions s JOIN users u ON u.id = s.author_id
      WHERE ${filter}
      ORDER BY ${order} LIMIT 11 OFFSET ${(page - 1) * 10}`),
      this.prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
        SELECT count(*)::int AS total FROM exercise_solutions s WHERE ${filter}`),
      this.prisma.$queryRaw<{ language: string; count: number }[]>`
        SELECT language, count(*)::int AS count FROM exercise_solutions
        WHERE exercise_id = ${exerciseId}::uuid AND deleted_at IS NULL
          AND language IS NOT NULL AND language <> ''
        GROUP BY language ORDER BY count DESC, language ASC LIMIT 30`,
    ]);
    return { items: rows.slice(0, 10), page, hasMore: rows.length > 10, total: totals[0]?.total ?? 0, languages };
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('exerciseId', ParseUUIDPipe) exerciseId: string,
    @Body() body: SolutionInput,
  ) {
    await this.publicExercise(exerciseId);
    const { title, explanation, code, language } = this.fields(body);
    const userId = requireHumanId(user);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO exercise_solutions (exercise_id, author_id, title, explanation, code, language)
      VALUES (${exerciseId}::uuid, ${userId}::uuid, ${title}, ${explanation}, ${code}, ${language}) RETURNING id`;
    return rows[0];
  }

  @Patch(':solutionId')
  async edit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('exerciseId', ParseUUIDPipe) exerciseId: string,
    @Param('solutionId', ParseUUIDPipe) solutionId: string,
    @Body() body: SolutionInput,
  ) {
    const existing = await this.solution(exerciseId, solutionId);
    if (existing.author_id !== requireHumanId(user)) throw new ForbiddenException();
    const { title, explanation, code, language } = this.fields(body);
    await this.prisma
      .$executeRaw`UPDATE exercise_solutions SET title = ${title}, explanation = ${explanation},
      code = ${code}, language = ${language}, updated_at = now() WHERE id = ${solutionId}::uuid`;
    return { id: solutionId };
  }

  @Delete(':solutionId')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('exerciseId', ParseUUIDPipe) exerciseId: string,
    @Param('solutionId', ParseUUIDPipe) solutionId: string,
  ) {
    const existing = await this.solution(exerciseId, solutionId);
    if (existing.author_id !== requireHumanId(user)) throw new ForbiddenException();
    await this.prisma
      .$executeRaw`UPDATE exercise_solutions SET deleted_at = now() WHERE id = ${solutionId}::uuid`;
    return { deleted: true };
  }

  @Post(':solutionId/vote')
  async vote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('exerciseId', ParseUUIDPipe) exerciseId: string,
    @Param('solutionId', ParseUUIDPipe) solutionId: string,
  ) {
    await this.solution(exerciseId, solutionId);
    const userId = requireHumanId(user);
    await this.prisma.$executeRaw`INSERT INTO exercise_solution_votes (solution_id, user_id)
      VALUES (${solutionId}::uuid, ${userId}::uuid) ON CONFLICT DO NOTHING`;
    return { voted: true };
  }

  @Delete(':solutionId/vote')
  async unvote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('exerciseId', ParseUUIDPipe) exerciseId: string,
    @Param('solutionId', ParseUUIDPipe) solutionId: string,
  ) {
    await this.solution(exerciseId, solutionId);
    await this.prisma
      .$executeRaw`DELETE FROM exercise_solution_votes WHERE solution_id = ${solutionId}::uuid AND user_id = ${requireHumanId(user)}::uuid`;
    return { voted: false };
  }

  @Get(':solutionId/comments')
  async comments(
    @Param('exerciseId', ParseUUIDPipe) exerciseId: string,
    @Param('solutionId', ParseUUIDPipe) solutionId: string,
  ) {
    await this.solution(exerciseId, solutionId);
    return this.prisma
      .$queryRaw`SELECT c.id, c.body, c.author_id AS "authorId", u.display_name AS "authorName",
      u.avatar_url AS "authorAvatar", c.created_at AS "createdAt", c.updated_at AS "updatedAt"
      FROM exercise_solution_comments c JOIN users u ON u.id = c.author_id
      WHERE c.solution_id = ${solutionId}::uuid AND c.deleted_at IS NULL ORDER BY c.created_at ASC LIMIT 200`;
  }

  @Post(':solutionId/comments')
  async comment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('exerciseId', ParseUUIDPipe) exerciseId: string,
    @Param('solutionId', ParseUUIDPipe) solutionId: string,
    @Body() body: CommentInput,
  ) {
    await this.solution(exerciseId, solutionId);
    const text = this.text(body.body, 'Bình luận', 1, 5000);
    const rows = await this.prisma.$queryRaw<
      { id: string }[]
    >`INSERT INTO exercise_solution_comments
      (solution_id, author_id, body) VALUES (${solutionId}::uuid, ${requireHumanId(user)}::uuid, ${text}) RETURNING id`;
    return rows[0];
  }

  @Delete(':solutionId/comments/:commentId')
  async removeComment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('exerciseId', ParseUUIDPipe) exerciseId: string,
    @Param('solutionId', ParseUUIDPipe) solutionId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    await this.solution(exerciseId, solutionId);
    const rows = await this.prisma.$queryRaw<
      { author_id: string }[]
    >`SELECT author_id FROM exercise_solution_comments
      WHERE id = ${commentId}::uuid AND solution_id = ${solutionId}::uuid AND deleted_at IS NULL`;
    if (!rows.length) throw new NotFoundException('Không tìm thấy bình luận');
    if (rows[0].author_id !== requireHumanId(user)) throw new ForbiddenException();
    await this.prisma
      .$executeRaw`UPDATE exercise_solution_comments SET deleted_at = now() WHERE id = ${commentId}::uuid`;
    return { deleted: true };
  }
}

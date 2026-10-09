import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser, requireHumanId, type AuthenticatedUser } from '@codementor/platform';
import { WorkspaceAiService } from '../application/workspace-ai.service';

export class AiPageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(30) limit = 20;
  @IsOptional() @IsString() @MaxLength(200) q?: string;
}
/** Tài liệu được chọn cho một lượt hỏi. Hội thoại không còn ở đây: Tutor chạy trên
 * `/api/v1/ai/tutor` của ai-service và gọi lại `documents/prepare`/`documents/status` này bằng
 * token của chính người dùng. */
export class AiDocumentIdsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  documentIds: string[];
}
@Controller({ path: 'workspaces/:slug/ai', version: '1' })
export class WorkspaceAiController {
  constructor(private readonly ai: WorkspaceAiService) {}
  @Get('status')
  status(@CurrentUser() user: AuthenticatedUser, @Param('slug') slug: string) {
    return this.ai.status(requireHumanId(user), slug);
  }
  @Get('documents')
  documents(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Query() query: AiPageQuery,
  ) {
    return this.ai.documents(requireHumanId(user), slug, query);
  }
  @Post('documents/:id/index')
  index(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ai.index(requireHumanId(user), slug, id);
  }
  @Post('documents/prepare')
  prepare(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body() body: AiDocumentIdsDto,
  ) {
    return this.ai.documentStates(requireHumanId(user), slug, body.documentIds, true);
  }
  @Post('documents/status')
  documentStates(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body() body: AiDocumentIdsDto,
  ) {
    return this.ai.documentStates(requireHumanId(user), slug, body.documentIds);
  }
}

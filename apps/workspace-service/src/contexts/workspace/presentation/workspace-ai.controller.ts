import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
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
  MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { CurrentUser, requireHumanId, type AuthenticatedUser } from '@codementor/platform';
import { WorkspaceAiService } from '../application/workspace-ai.service';

export class AiPageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(30) limit = 20;
  @IsOptional() @IsString() @MaxLength(200) q?: string;
}
export class CreateAiConversationDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  documentIds: string[];
}
export class AskAiDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(4000)
  question: string;
  @IsUUID('4') requestId: string;
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
    @Body() body: CreateAiConversationDto,
  ) {
    return this.ai.documentStates(requireHumanId(user), slug, body.documentIds, true);
  }
  @Post('documents/status')
  documentStates(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body() body: CreateAiConversationDto,
  ) {
    return this.ai.documentStates(requireHumanId(user), slug, body.documentIds);
  }
  @Get('conversations')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Query() query: AiPageQuery,
  ) {
    return this.ai.list(requireHumanId(user), slug, { page: query.page, limit: query.limit });
  }
  @Post('conversations')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body() body: CreateAiConversationDto,
  ) {
    return this.ai.create(requireHumanId(user), slug, body.documentIds);
  }
  @Get('conversations/:id')
  read(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ai.read(requireHumanId(user), slug, id);
  }
  @Delete('conversations/:id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ai.remove(requireHumanId(user), slug, id);
  }
  @Post('conversations/:id/messages')
  ask(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AskAiDto,
  ) {
    return this.ai.ask(requireHumanId(user), slug, id, body.question, body.requestId);
  }
}

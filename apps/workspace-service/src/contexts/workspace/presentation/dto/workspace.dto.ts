import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const WORKSPACE_SCOPES = ['all', 'owned', 'joined'] as const;
export const WORKSPACE_ROLES = ['deputy', 'member'] as const;
export const WORKSPACE_PERMISSIONS = [
  'view_doc',
  'upload_doc',
  'edit_own_doc',
  'delete_own_doc',
  'manage_doc',
  'approve_doc',
  'view_exercise',
  'create_exercise',
  'edit_own_exercise',
  'delete_own_exercise',
  'manage_exercise',
  'assign_exercise',
  'edit_exercise',
  'delete_doc',
  'review_submission',
  'remove_member',
] as const;

export class ListWorkspacesQueryDto {
  @ApiPropertyOptional({ enum: WORKSPACE_SCOPES, default: 'all' })
  @IsOptional()
  @IsIn(WORKSPACE_SCOPES)
  scope?: (typeof WORKSPACE_SCOPES)[number];

  @ApiPropertyOptional({ description: 'Tìm theo tên, mô tả hoặc chủ đề' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  topic?: string;

  @ApiPropertyOptional({ description: 'Cursor nhận từ nextCursor' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @ApiPropertyOptional({ default: 12, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class ListMembersQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ description: 'Alias rõ nghĩa của q' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: ['owner', ...WORKSPACE_ROLES] })
  @IsOptional()
  @IsIn(['owner', ...WORKSPACE_ROLES])
  role?: 'owner' | (typeof WORKSPACE_ROLES)[number];

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ enum: ['not_started', 'in_progress', 'completed'] })
  @IsOptional()
  @IsIn(['not_started', 'in_progress', 'completed'])
  progress?: 'not_started' | 'in_progress' | 'completed';

  @ApiPropertyOptional({ enum: ['low', 'medium', 'high'] })
  @IsOptional()
  @IsIn(['low', 'medium', 'high'])
  activityLevel?: 'low' | 'medium' | 'high';

  @ApiPropertyOptional({ enum: ['not_submitted', 'submitted', 'passed'] })
  @IsOptional()
  @IsIn(['not_submitted', 'submitted', 'passed'])
  submissionStatus?: 'not_submitted' | 'submitted' | 'passed';

  @ApiPropertyOptional({ description: 'Ngày tham gia từ (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  joinedFrom?: string;

  @ApiPropertyOptional({ description: 'Ngày tham gia đến (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  joinedTo?: string;
}

export class CreateWorkspaceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  topic?: string;
}

export class UpdateWorkspaceDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  topic?: string | null;

  @IsOptional() @IsIn(['public', 'private']) privacy?: 'public' | 'private';
  @IsOptional() @IsIn(['open', 'approval', 'invite_only']) joinPolicy?:
    'open' | 'approval' | 'invite_only';
  @IsOptional() @IsString() @MaxLength(2000) avatarUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) avatarKey?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) coverUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) coverKey?: string | null;
}

export class JoinWorkspaceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  inviteCode!: string;
}

/** Invitation is intentionally handle-based: no cross-service email table or password data is copied into Workspace. */
export class InviteWorkspaceMemberDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  handle!: string;
}

export class UpdateMemberRoleDto {
  @IsIn(WORKSPACE_ROLES)
  role!: (typeof WORKSPACE_ROLES)[number];
}

export class TransferOwnershipDto {
  @IsString()
  @IsNotEmpty()
  memberId!: string;
}

export class UpdateRolePermissionsDto {
  @IsObject()
  permissions!: Partial<Record<(typeof WORKSPACE_PERMISSIONS)[number], boolean>>;
}

export class UpdateMemberPermissionsDto {
  @IsObject()
  permissions!: Partial<Record<(typeof WORKSPACE_PERMISSIONS)[number], boolean | null>>;
}

export class RequestWorkspaceJoinDto {
  @IsOptional() @IsString() @MaxLength(500) message?: string;
}

export class WorkspaceContentQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() @MaxLength(200) q?: string;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsString() @MaxLength(50) status?: string;
  @IsOptional() @IsString() @MaxLength(100) type?: string;
  @IsOptional() @IsString() @MaxLength(50) difficulty?: string;
  @IsOptional() @IsIn(['all', 'assigned', 'public']) scope?: 'all' | 'assigned' | 'public';
}

export class WorkspaceOverviewQueryDto {
  @IsOptional() @IsString() @MaxLength(200) activitySearch?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) activityPage?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) activityLimit?: number;
}

export class DocumentUploadUrlDto {
  @IsString() @IsNotEmpty() @MaxLength(255) filename!: string;
  @IsString() @IsNotEmpty() @MaxLength(150) contentType!: string;
  @Type(() => Number) @IsInt() @Min(1) sizeBytes!: number;
}

export class WorkspaceAssetUploadUrlDto extends DocumentUploadUrlDto {
  @IsIn(['cover']) kind!: 'cover';
}

export class CreateWorkspaceDocumentDto extends DocumentUploadUrlDto {
  @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) docType!: string;
  @IsOptional() @IsString() @MaxLength(100) topic?: string;
  @IsString() @IsNotEmpty() @MaxLength(1000) storageKey!: string;
  @IsString() @IsNotEmpty() @MaxLength(2000) url!: string;
}

export class UpdateWorkspaceDocumentDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(100) topic?: string | null;
  @IsOptional() @IsIn(['published', 'pending', 'changes', 'rejected', 'hidden']) status?: string;
}

export class RemoveWorkspaceContentDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class ReportWorkspaceDocumentDto {
  @IsIn(['spam', 'inappropriate', 'copyright', 'harmful', 'irrelevant', 'other'])
  category!: 'spam' | 'inappropriate' | 'copyright' | 'harmful' | 'irrelevant' | 'other';

  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class CreateWorkspaceExerciseDto {
  @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(500) summary?: string;
  @IsIn(['easy', 'medium', 'hard']) difficulty!: 'easy' | 'medium' | 'hard';
  @IsOptional() @IsIn(['manual', 'ai']) source?: 'manual' | 'ai';
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) xpReward?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(60000) timeLimitMs?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1024) @Max(4194304) memoryLimitKb?: number;
  @IsObject() content!: Record<string, unknown>;
  @IsOptional() @IsDateString() dueAt?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) attemptLimit?: number;
  @IsOptional() @IsBoolean() allowRetry?: boolean;
  @IsOptional() @IsBoolean() allowLateSubmission?: boolean;
  @IsArray() @IsUUID(undefined, { each: true }) memberIds!: string[];
}

export class GenerateWorkspaceExerciseDraftDto {
  @IsString() @IsNotEmpty() @MaxLength(300) prompt!: string;
  @IsOptional() @IsArray() @IsUUID(undefined, { each: true }) documentIds?: string[];
  @IsOptional() @IsIn(['easy', 'medium', 'hard']) difficulty?: 'easy' | 'medium' | 'hard';
}

export class AttachWorkspaceExerciseDto {
  @IsUUID() exerciseId!: string;
  @IsOptional() @IsDateString() dueAt?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) attemptLimit?: number;
  @IsOptional() @IsBoolean() allowRetry?: boolean;
  @IsOptional() @IsBoolean() allowLateSubmission?: boolean;
  @IsArray() @IsUUID(undefined, { each: true }) memberIds!: string[];
}

export class UpdateWorkspaceExerciseDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(500) summary?: string | null;
  @IsOptional() @IsIn(['easy', 'medium', 'hard']) difficulty?: 'easy' | 'medium' | 'hard';
  @IsOptional() @IsIn(['published', 'hidden']) publicationStatus?: 'published' | 'hidden';
  @IsOptional() @IsObject() content?: Record<string, unknown>;
  @IsOptional() @IsDateString() dueAt?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) attemptLimit?: number | null;
  @IsOptional() @IsBoolean() allowRetry?: boolean;
  @IsOptional() @IsBoolean() allowLateSubmission?: boolean;
  @IsOptional() @IsArray() @IsUUID(undefined, { each: true }) memberIds?: string[];
}

export class UpdateWorkspaceAssignmentDto {
  @IsOptional() @IsIn(['notstarted', 'inprogress', 'done', 'late']) status?: string;
  @IsOptional() @IsIn(['pending', 'approved', 'needsfix']) reviewStatus?: string;
  @IsOptional() @IsString() @MaxLength(2000) feedback?: string | null;
}

export class ListWorkspaceMessagesQueryDto {
  @IsOptional() @IsString() @MaxLength(500) before?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

export class CreateWorkspaceMessageDto {
  @IsString() @IsNotEmpty() @MaxLength(4000) content!: string;
}

export class UpdateWorkspaceMessageDto extends CreateWorkspaceMessageDto {}

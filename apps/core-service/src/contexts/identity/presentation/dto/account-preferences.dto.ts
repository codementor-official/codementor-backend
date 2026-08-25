import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional() @IsBoolean() emailNotifications?: boolean;
  @IsOptional() @IsBoolean() workspaceNotifications?: boolean;
  @IsOptional() @IsBoolean() learningReminders?: boolean;
  @IsOptional() @IsBoolean() weeklyDigest?: boolean;
  @IsOptional() @IsBoolean() publicProfile?: boolean;
  @IsOptional() @IsBoolean() showLearningProgress?: boolean;
  @IsOptional() @IsBoolean() allowWorkspaceInvites?: boolean;
  @IsOptional() @IsIn(['light', 'dark', 'system']) theme?: 'light' | 'dark' | 'system';
}

export class StudyScheduleSlotDto {
  @IsIn(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
  weekday!: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

  @IsBoolean()
  enabled!: boolean;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startTime!: string;

  @IsInt()
  @Min(5)
  @Max(1440)
  durationMinutes!: number;
}

export class UpdatePreferencesDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(160)
  learningGoal?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(160)
  careerGoal?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(['none', 'basic', 'intermediate', 'experienced'])
  currentLevel?: 'none' | 'basic' | 'intermediate' | 'experienced' | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(['theory', 'practice', 'project'])
  contentPriority?: 'theory' | 'practice' | 'project' | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(168)
  weeklyStudyHours?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(['frontend', 'backend', 'fullstack', 'mobile', 'data-ai', 'foundation'], {
    each: true,
  })
  interestedFields?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  interestedTechnologies?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(['video', 'article', 'hands-on', 'group', 'self-paced'], { each: true })
  preferredLearningStyle?: string[];

  @IsOptional() @IsBoolean() remindersEnabled?: boolean;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) reminderTime?: string;
  @IsOptional() @IsBoolean() adaptiveRecommendations?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique((slot: StudyScheduleSlotDto) => slot.weekday)
  @ValidateNested({ each: true })
  @Type(() => StudyScheduleSlotDto)
  schedule?: StudyScheduleSlotDto[];
}

export class AvatarUploadDto {
  @IsString()
  @MaxLength(255)
  filename!: string;

  @IsIn(['image/png', 'image/jpeg', 'image/webp'])
  contentType!: string;

  @IsInt()
  @Min(1)
  @Max(5 * 1024 * 1024)
  sizeBytes!: number;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { UserRole } from '@codementor/platform';

export const ASSIGNABLE_HUMAN_ROLES = [
  UserRole.STUDENT,
  UserRole.LECTURER,
  UserRole.ADMIN,
] as const;

export class CreateUserDto {
  @ApiProperty({ example: 'student@codementor.dev' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'CodeMentor Student' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName!: string;

  @ApiProperty({ enum: ASSIGNABLE_HUMAN_ROLES })
  @IsIn([...ASSIGNABLE_HUMAN_ROLES])
  role!: UserRole;

  @ApiPropertyOptional({ description: 'Temporary credential stored only by Keycloak' })
  @IsOptional()
  @IsString()
  @MinLength(12)
  temporaryPassword?: string;
}

export class UpdateUserRoleDto {
  @ApiProperty({ enum: ASSIGNABLE_HUMAN_ROLES })
  @IsIn([...ASSIGNABLE_HUMAN_ROLES])
  role!: UserRole;
}

export enum UserAccountStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}

export class UpdateUserStatusDto {
  @ApiProperty({ enum: UserAccountStatus })
  @IsEnum(UserAccountStatus)
  status!: UserAccountStatus;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PageQuery, UserRole } from '@codementor/platform';

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

  /**
   * Bắt buộc, và KHÔNG phải mật khẩu tạm.
   *
   * Đặt `temporary: true` sinh ra required action `UPDATE_PASSWORD`, mà Direct Access
   * Grant — đường đăng nhập duy nhất của form trong ứng dụng — không phục vụ được: nó
   * trả `invalid_grant`, và màn đăng nhập hiển thị đúng chữ "sai mật khẩu". Tài khoản
   * tạo ra như vậy không đăng nhập được ở đâu cả.
   */
  @ApiProperty({ description: 'Mật khẩu đăng nhập, do quản trị viên đặt và trao tay' })
  @IsString()
  @MinLength(12)
  password!: string;
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

/** Nhận vai trò/trạng thái theo đúng giá trị enum trong PostgreSQL, không phải tên Keycloak. */
export const PLATFORM_ROLES = ['learner', 'lecturer', 'admin'] as const;
export const ACCOUNT_STATUSES = ['active', 'suspended', 'deleted'] as const;

export class ListUsersQueryDto extends PageQuery {
  @ApiPropertyOptional({ enum: PLATFORM_ROLES })
  @IsOptional()
  @IsIn([...PLATFORM_ROLES])
  role?: (typeof PLATFORM_ROLES)[number];

  @ApiPropertyOptional({ enum: ACCOUNT_STATUSES })
  @IsOptional()
  @IsIn([...ACCOUNT_STATUSES])
  status?: (typeof ACCOUNT_STATUSES)[number];
}

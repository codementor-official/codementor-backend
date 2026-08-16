import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { CurrentUser, requireHumanId } from '@codementor/platform';
import type { AuthenticatedUser } from '@codementor/platform';
import { GetProfileUseCase } from '../application/get-profile.usecase';
import { UpdateProfileUseCase } from '../application/update-profile.usecase';
import { UserResponse } from './dto/user.response';

/**
 * Chỉ cho phép các múi giờ Việt Nam đang dùng. Danh sách IANA đầy đủ là 400+ giá trị
 * và không có cái nào khác từng xuất hiện trong sản phẩm; mở rộng khi thật sự cần.
 */
const TIMEZONES = ['Asia/Ho_Chi_Minh', 'Asia/Bangkok', 'UTC'] as const;
const LOCALES = ['vi', 'en'] as const;

/**
 * `null` = xoá giá trị, vắng mặt = giữ nguyên. `@ValidateIf` cho phép null đi qua
 * mà vẫn chặn kiểu sai — không có nó thì `IsString` từ chối luôn cả null.
 */
class UpdateProfileDto {
  @ApiProperty({ example: 'Nguyễn Trần Gia Sĩ', required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName?: string;

  @ApiProperty({ example: 'giasi', required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(30)
  handle?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(2000)
  bio?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(2048)
  avatarUrl?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(2048)
  websiteUrl?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(39)
  githubHandle?: string | null;

  @ApiProperty({ enum: LOCALES, required: false })
  @IsOptional()
  @IsIn(LOCALES)
  locale?: string;

  @ApiProperty({ enum: TIMEZONES, required: false })
  @IsOptional()
  @IsIn(TIMEZONES)
  timezone?: string;
}

/**
 * KHÔNG có endpoint đăng ký / đăng nhập / đổi mật khẩu ở đây.
 * Toàn bộ luồng đó thuộc Keycloak (kể cả social login) — frontend chuyển hướng tới Keycloak,
 * nhận access token, rồi gọi API này kèm `Authorization: Bearer`.
 *
 * Email, vai trò và trạng thái tài khoản cũng không sửa được qua đây: email thuộc
 * Keycloak, vai trò do realm role quyết định, trạng thái là việc của quản trị.
 */
@ApiTags('identity')
@ApiBearerAuth('access-token')
@Controller({ path: 'me', version: '1' })
export class IdentityController {
  constructor(
    private readonly getProfile: GetProfileUseCase,
    private readonly updateProfile: UpdateProfileUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Hồ sơ của tài khoản đang đăng nhập' })
  @ApiResponse({ status: 200, type: UserResponse })
  me(@CurrentUser() user: AuthenticatedUser): Promise<UserResponse> {
    return this.getProfile.execute(requireHumanId(user));
  }

  @Patch()
  @ApiOperation({ summary: 'Cập nhật hồ sơ' })
  @ApiResponse({ status: 200, type: UserResponse })
  @ApiResponse({ status: 409, description: 'Handle đã có người dùng' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserResponse> {
    return this.updateProfile.execute(requireHumanId(user), dto);
  }
}

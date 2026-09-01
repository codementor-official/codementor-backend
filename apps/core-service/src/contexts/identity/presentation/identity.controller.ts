import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { CurrentUser, requireHumanId } from '@codementor/platform';
import type { AuthenticatedUser } from '@codementor/platform';
import { GetProfileUseCase } from '../application/get-profile.usecase';
import { UpdateProfileUseCase } from '../application/update-profile.usecase';
import { AccountPreferencesService } from '../application/account-preferences.service';
import { PresignAvatarUploadUseCase } from '../application/presign-avatar-upload.usecase';
import { UserResponse } from './dto/user.response';
import {
  AvatarUploadDto,
  BOOKMARK_TARGETS,
  BookmarkQueryDto,
  SaveBookmarkDto,
  UpdatePreferencesDto,
  UpdateSettingsDto,
} from './dto/account-preferences.dto';
import type { BookmarkTarget } from '../domain/port/account-preferences.repository';

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
    private readonly accountPreferences: AccountPreferencesService,
    private readonly presignAvatarUpload: PresignAvatarUploadUseCase,
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

  @Post('avatar/upload-url')
  @ApiOperation({ summary: 'Tạo URL S3 tạm thời để tải ảnh đại diện lên' })
  avatarUploadUrl(@CurrentUser() user: AuthenticatedUser, @Body() dto: AvatarUploadDto) {
    return this.presignAvatarUpload.execute(requireHumanId(user), dto);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Cài đặt của tài khoản đang đăng nhập' })
  settings(@CurrentUser() user: AuthenticatedUser) {
    return this.accountPreferences.getSettings(requireHumanId(user));
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Cập nhật cài đặt của tài khoản đang đăng nhập' })
  updateSettings(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateSettingsDto) {
    return this.accountPreferences.updateSettings(requireHumanId(user), dto);
  }

  @Delete('settings')
  @ApiOperation({ summary: 'Đặt lại cài đặt về mặc định' })
  resetSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.accountPreferences.resetSettings(requireHumanId(user));
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Cấu hình cá nhân hoá của tài khoản đang đăng nhập' })
  preferences(@CurrentUser() user: AuthenticatedUser) {
    return this.accountPreferences.getPreferences(requireHumanId(user));
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Lưu cấu hình cá nhân hoá, chưa kích hoạt recommendation engine' })
  updatePreferences(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdatePreferencesDto) {
    return this.accountPreferences.updatePreferences(requireHumanId(user), dto);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Thống kê học tập đã lưu của tài khoản đang đăng nhập' })
  stats(@CurrentUser() user: AuthenticatedUser) {
    return this.accountPreferences.getStats(requireHumanId(user));
  }

  @Get('bookmarks')
  @ApiOperation({ summary: 'Danh sách nội dung người dùng đã lưu' })
  bookmarks(@CurrentUser() user: AuthenticatedUser, @Query() query: BookmarkQueryDto) {
    return this.accountPreferences.bookmarks(
      requireHumanId(user),
      {
        targetType: query.type,
        q: query.q,
        sort: query.sort,
        page: query.page,
        limit: query.limit,
      },
    );
  }

  @Get('bookmarks/:type/:targetId')
  @ApiOperation({ summary: 'Kiểm tra một nội dung đã được lưu hay chưa' })
  bookmarkStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('type', new ParseEnumPipe(BOOKMARK_TARGETS)) type: BookmarkTarget,
    @Param('targetId', new ParseUUIDPipe()) targetId: string,
  ) {
    return this.accountPreferences.bookmarkStatus(requireHumanId(user), type, targetId);
  }

  @Post('bookmarks')
  @ApiOperation({ summary: 'Lưu một nội dung để xem lại' })
  saveBookmark(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveBookmarkDto) {
    return this.accountPreferences.saveBookmark(requireHumanId(user), dto);
  }

  @Delete('bookmarks/:type/:targetId')
  @ApiOperation({ summary: 'Bỏ lưu nội dung' })
  async removeBookmark(
    @CurrentUser() user: AuthenticatedUser,
    @Param('type', new ParseEnumPipe(BOOKMARK_TARGETS)) type: BookmarkTarget,
    @Param('targetId', new ParseUUIDPipe()) targetId: string,
  ) {
    await this.accountPreferences.removeBookmark(requireHumanId(user), type, targetId);
    return { removed: true };
  }
}

import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CurrentUser } from '@codementor/platform';
import type { AuthenticatedUser } from '@codementor/platform';
import { UserResponse } from './dto/user.response';

class UpdateProfileDto {
  @ApiProperty({ example: 'Nguyễn Trần Gia Sĩ' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName!: string;
}

/**
 * KHÔNG có endpoint đăng ký / đăng nhập / đổi mật khẩu ở đây.
 * Toàn bộ luồng đó thuộc Keycloak (kể cả social login) — frontend chuyển hướng tới Keycloak,
 * nhận access token, rồi gọi API này kèm `Authorization: Bearer`.
 */
@ApiTags('identity')
@ApiBearerAuth('access-token')
@Controller({ path: 'me', version: '1' })
export class IdentityController {
  @Get()
  @ApiOperation({ summary: 'Hồ sơ của tài khoản đang đăng nhập' })
  @ApiResponse({ status: 200, type: UserResponse })
  me(@CurrentUser() user: AuthenticatedUser): UserResponse {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    };
  }

  @Patch()
  @ApiOperation({ summary: 'Cập nhật hồ sơ hiển thị' })
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() _dto: UpdateProfileDto,
  ): UserResponse {
    // TODO: nối vào UpdateProfileUseCase khi hiện thực đầy đủ context Identity.
    return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
  }
}

import { Body, Controller, ForbiddenException, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CurrentUser, Roles, UserRole } from '@codementor/platform';
import type { AuthenticatedUser } from '@codementor/platform';
import { UserResponse } from './dto/user.response';
import {
  CreateUserDto,
  UpdateUserRoleDto,
  UpdateUserStatusDto,
  UserAccountStatus,
} from './dto/admin-user.dto';
import { KeycloakAdminService } from '../infrastructure/keycloak-admin.service';

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
@Controller({ path: 'users', version: '1' })
export class IdentityController {
  constructor(private readonly keycloak: KeycloakAdminService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Danh sách tài khoản Keycloak' })
  listUsers() {
    return this.keycloak.listUsers();
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Tạo tài khoản con người trong Keycloak' })
  createUser(@Body() dto: CreateUserDto) {
    return this.keycloak.createUser(dto);
  }

  @Get('me')
  @ApiOperation({ summary: 'Hồ sơ của tài khoản đang đăng nhập' })
  @ApiResponse({ status: 200, type: UserResponse })
  me(@CurrentUser() user: AuthenticatedUser): UserResponse {
    if (user.actorType !== 'human' || !user.id || !user.email) {
      throw new ForbiddenException('Service account không có hồ sơ người dùng');
    }
    return {
      id: user.id,
      keycloakUserId: user.externalId,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles,
    };
  }

  @Patch('me')
  @ApiOperation({ summary: 'Cập nhật hồ sơ hiển thị' })
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() _dto: UpdateProfileDto,
  ): UserResponse {
    // TODO: nối vào UpdateProfileUseCase khi hiện thực đầy đủ context Identity.
    if (user.actorType !== 'human' || !user.id || !user.email) {
      throw new ForbiddenException('Service account không có hồ sơ người dùng');
    }
    return {
      id: user.id,
      keycloakUserId: user.externalId,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles,
    };
  }

  @Patch(':id/role')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Gán một vai trò con người cho tài khoản' })
  updateRole(@Param('id') id: string, @Body() dto: UpdateUserRoleDto) {
    return this.keycloak.assignHumanRole(id, dto.role);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Bật hoặc tạm khoá tài khoản' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateUserStatusDto) {
    return this.keycloak.setEnabled(id, dto.status === UserAccountStatus.ACTIVE);
  }

  @Get('ai-agent/ping')
  @Roles(UserRole.AI_AGENT)
  @ApiOperation({ summary: 'Kiểm tra quyền service account AI Agent' })
  aiAgentPing(@CurrentUser() user: AuthenticatedUser) {
    return { authenticated: true, subject: user.externalId, roles: user.roles };
  }
}

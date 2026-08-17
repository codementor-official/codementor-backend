import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '@codementor/platform';
import type { AuthenticatedUser } from '@codementor/platform';
import { KeycloakAdminService } from '../infrastructure/keycloak-admin.service';
import { ListUsersUseCase } from '../application/list-users.usecase';
import {
  CreateUserDto,
  ListUsersQueryDto,
  UpdateUserRoleDto,
  UpdateUserStatusDto,
  UserAccountStatus,
} from './dto/admin-user.dto';

/**
 * Quản trị tài khoản Ở KEYCLOAK, tách khỏi `IdentityController`.
 *
 * Hai controller vì hai đường dẫn: hồ sơ của chính mình phải ở lại `/api/v1/me` — đó là
 * đường Kong định tuyến và là đường cả ba frontend đang gọi. Gộp chung vào `/users` sẽ
 * lặng lẽ làm hỏng đăng nhập ở mọi client.
 *
 * Ở đây không đụng bảng `users` của ta: vai trò và trạng thái tài khoản do Keycloak sở hữu,
 * còn hàng trong `users` được tạo lúc token đầu tiên đi qua (just-in-time provisioning).
 */
@ApiTags('identity')
@ApiBearerAuth('access-token')
@Controller({ path: 'users', version: '1' })
export class AdminUsersController {
  constructor(
    private readonly keycloak: KeycloakAdminService,
    private readonly directory: ListUsersUseCase,
  ) {}

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'Danh sách tài khoản, có tìm kiếm/lọc/phân trang' })
  listUsers(@Query() query: ListUsersQueryDto) {
    return this.directory.execute(query);
  }

  @Get('summary')
  @Roles('admin')
  @ApiOperation({ summary: 'Tổng số tài khoản và phân bố theo vai trò' })
  summary() {
    return this.directory.summary();
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Tạo tài khoản con người trong Keycloak' })
  createUser(@Body() dto: CreateUserDto) {
    return this.keycloak.createUser(dto);
  }

  @Patch(':id/role')
  @Roles('admin')
  @ApiOperation({ summary: 'Gán một vai trò con người cho tài khoản' })
  updateRole(@Param('id') id: string, @Body() dto: UpdateUserRoleDto) {
    return this.keycloak.assignHumanRole(id, dto.role);
  }

  @Patch(':id/status')
  @Roles('admin')
  @ApiOperation({ summary: 'Bật hoặc tạm khoá tài khoản' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateUserStatusDto) {
    return this.keycloak.setEnabled(id, dto.status === UserAccountStatus.ACTIVE);
  }

  @Get('ai-agent/ping')
  @Roles('ai_agent')
  @ApiOperation({ summary: 'Kiểm tra quyền service account AI Agent' })
  aiAgentPing(@CurrentUser() user: AuthenticatedUser) {
    return { authenticated: true, subject: user.externalId, role: user.role };
  }
}

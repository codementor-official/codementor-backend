import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '@codementor/platform';
import type { AuthenticatedUser } from '@codementor/platform';
import { AuditLogService } from '../../audit/application/audit-log.service';
import { KeycloakAdminService } from '../infrastructure/keycloak-admin.service';
import { GetAdminUserUseCase } from '../application/get-admin-user.usecase';
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
    private readonly profile: GetAdminUserUseCase,
    private readonly audit: AuditLogService,
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

  // Sau `summary` và trước mọi route `:id/...`: Nest khớp theo thứ tự khai báo, đặt trên
  // `summary` thì "summary" bị đọc thành một id và `ParseUUIDPipe` trả 400.
  @Get(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Hồ sơ đầy đủ một tài khoản, kèm thống kê và khảo sát' })
  getUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.profile.execute(id);
  }

  // Ghi nhật ký SAU khi Keycloak trả về, không phải trước: ghi trước là ghi lại một việc
  // có thể đã không xảy ra, và một nhật ký kiểm toán nói sai còn tệ hơn không có.
  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Tạo tài khoản con người trong Keycloak' })
  async createUser(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateUserDto) {
    const created = await this.keycloak.createUser(dto);
    await this.audit.record(actor, {
      action: 'user.created',
      targetType: 'user',
      targetId: dto.email,
      summary: `Tạo tài khoản ${dto.email} với vai trò ${dto.role}`,
      metadata: { email: dto.email, role: dto.role },
    });
    return created;
  }

  @Patch(':id/role')
  @Roles('admin')
  @ApiOperation({ summary: 'Gán một vai trò con người cho tài khoản' })
  async updateRole(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserRoleDto,
  ) {
    const result = await this.keycloak.assignHumanRole(id, dto.role);
    await this.audit.record(actor, {
      action: 'user.role_changed',
      // `id` ở đây là `sub` của Keycloak, khác với `users.id`. Ghi cả hai để drawer chi
      // tiết tra được theo id nào cũng ra — xem `externalId` trong hồ sơ.
      targetType: 'user',
      targetId: id,
      summary: `Đổi vai trò tài khoản thành ${dto.role}`,
      metadata: { role: dto.role, keycloakId: id },
    });
    return result;
  }

  @Patch(':id/status')
  @Roles('admin')
  @ApiOperation({ summary: 'Bật hoặc tạm khoá tài khoản' })
  async updateStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    const active = dto.status === UserAccountStatus.ACTIVE;
    const result = await this.keycloak.setEnabled(id, active);
    await this.audit.record(actor, {
      action: active ? 'user.activated' : 'user.suspended',
      targetType: 'user',
      targetId: id,
      summary: active ? 'Mở khoá tài khoản' : 'Tạm khoá tài khoản',
      metadata: { status: dto.status, keycloakId: id },
    });
    return result;
  }

  @Get('ai-agent/ping')
  @Roles('ai_agent')
  @ApiOperation({ summary: 'Kiểm tra quyền service account AI Agent' })
  aiAgentPing(@CurrentUser() user: AuthenticatedUser) {
    return { authenticated: true, subject: user.externalId, role: user.role };
  }
}

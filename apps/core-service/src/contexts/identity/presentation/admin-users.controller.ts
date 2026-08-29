import { Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '@codementor/platform';
import type { AuthenticatedUser } from '@codementor/platform';
import { AuditLogService } from '../../audit/application/audit-log.service';
import { KeycloakAdminService } from '../infrastructure/keycloak-admin.service';
import { GetAdminUserUseCase } from '../application/get-admin-user.usecase';
import { MirrorAccountUseCase } from '../application/mirror-account.usecase';
import { ListUsersUseCase } from '../application/list-users.usecase';
import { AccountPreferencesService } from '../application/account-preferences.service';
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
 * Keycloak sở hữu vai trò và quyền đăng nhập; hàng trong `users` được tạo lúc token đầu
 * tiên đi qua (just-in-time provisioning). Ngoại lệ là `users.role` và `users.status`:
 * cả hai được chép lại sau khi đổi, vì mọi màn hình đọc hai cột đó chứ không hỏi Keycloak
 * — xem `MirrorAccountUseCase` cho lý do đầy đủ.
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
    private readonly mirror: MirrorAccountUseCase,
    private readonly accountPreferences: AccountPreferencesService,
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

  @Get('growth')
  @Roles('admin')
  @ApiOperation({ summary: 'Tài khoản mới theo tháng, cho biểu đồ tăng trưởng' })
  growth() {
    return this.directory.growth();
  }

  @Get('leaderboard')
  @ApiOperation({ summary: 'Bảng xếp hạng XP công khai cho màn Khám phá' })
  leaderboard(@Query('limit', new DefaultValuePipe(5), ParseIntPipe) limit: number) {
    return this.accountPreferences.leaderboard(limit);
  }

  // Sau `summary`/`growth` và trước mọi route `:id/...`: Nest khớp theo thứ tự khai báo,
  // đặt trên chúng thì "summary" bị đọc thành một id và `ParseUUIDPipe` trả 400.
  @Get(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Hồ sơ đầy đủ một tài khoản, kèm thống kê và khảo sát' })
  getUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.profile.execute(id);
  }

  @Get(':id/login-history')
  @Roles('admin')
  @ApiOperation({ summary: 'Lịch sử đăng nhập từ Keycloak, mới nhất trước' })
  loginHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.profile.loginHistory(id);
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
    // Cùng lý do với khoá/mở: danh sách quản trị đọc `users.role` chứ không hỏi Keycloak,
    // nên không chép về thì đổi vai trò xong bảng vẫn hiện vai trò cũ.
    await this.mirror.role(id, dto.role);
    await this.audit.record(actor, {
      action: 'user.role_changed',
      targetType: 'user',
      targetId: await this.auditTargetId(id),
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
    // Keycloak đã là nguồn sự thật cho việc đăng nhập, nhưng mọi màn hình đọc
    // `users.status` — không chép về thì khoá xong danh sách vẫn hiện "đang hoạt động".
    await this.mirror.status(id, active);
    await this.audit.record(actor, {
      action: active ? 'user.activated' : 'user.suspended',
      targetType: 'user',
      targetId: await this.auditTargetId(id),
      summary: active ? 'Mở khoá tài khoản' : 'Tạm khoá tài khoản',
      metadata: { status: dto.status, keycloakId: id },
    });
    return result;
  }

  /**
   * Khoá của dòng nhật ký cho một tài khoản.
   *
   * Các endpoint quản trị ở đây nhận `sub` của Keycloak trên URL vì chúng gọi thẳng
   * Keycloak, nhưng màn chi tiết tài khoản tra nhật ký bằng `users.id` — cùng id mà
   * `GET /users/:id` dùng. Ghi theo id Keycloak nghĩa là bộ lọc ấy luôn trả về rỗng, và
   * rỗng ở đây trông y hệt "chưa có ai làm gì".
   *
   * Chưa có hàng trong `users` thì lùi về id Keycloak: một dòng nhật ký khoá bằng id lạ
   * vẫn hơn là mất hẳn dòng đó.
   */
  private async auditTargetId(keycloakUserId: string): Promise<string> {
    return (await this.profile.resolveUserId(keycloakUserId)) ?? keycloakUserId;
  }

  @Get('ai-agent/ping')
  @Roles('ai_agent')
  @ApiOperation({ summary: 'Kiểm tra quyền service account AI Agent' })
  aiAgentPing(@CurrentUser() user: AuthenticatedUser) {
    return { authenticated: true, subject: user.externalId, role: user.role };
  }
}

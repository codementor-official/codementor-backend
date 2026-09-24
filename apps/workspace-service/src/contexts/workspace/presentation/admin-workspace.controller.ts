import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '@codementor/platform';
import type { AuthenticatedUser } from '@codementor/platform';
import { AdminWorkspaceService } from '../application/admin-workspace.service';
import {
  AdminListWorkspacesQueryDto,
  ListMembersQueryDto,
  RemoveWorkspaceContentDto,
} from './dto/workspace.dto';

/**
 * Đường quản trị nằm dưới `/workspaces/manage` để đi chung route Kong với phần còn lại.
 * Controller này PHẢI đăng ký trước `WorkspaceController` trong module: nếu không,
 * `GET /workspaces/:slug` bắt mất `GET /workspaces/manage`. Slug thật luôn có hậu tố
 * ngẫu nhiên nên không nhóm nào tên đúng `manage`.
 */
@ApiTags('workspaces-admin')
@ApiBearerAuth('access-token')
@Controller({ path: 'workspaces/manage', version: '1' })
@Roles('admin')
export class AdminWorkspaceController {
  constructor(private readonly admin: AdminWorkspaceService) {}

  @Get()
  @ApiOperation({ summary: 'Mọi nhóm học tập trên nền tảng' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: AdminListWorkspacesQueryDto) {
    return this.admin.list(user, query);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Đếm nhóm theo trạng thái và quyền riêng tư' })
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.admin.summary(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết nhóm kèm thành viên' })
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListMembersQueryDto,
  ) {
    return this.admin.detail(user, id, query);
  }

  @Post(':id/archive')
  @ApiOperation({ summary: 'Lưu trữ nhóm' })
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RemoveWorkspaceContentDto,
  ) {
    return this.admin.setStatus(user, id, 'archived', dto.reason);
  }

  @Post(':id/restore')
  @ApiOperation({ summary: 'Khôi phục nhóm đã lưu trữ' })
  restore(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.setStatus(user, id, 'active');
  }

  @Delete(':id/members/:memberId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Gỡ thành viên vi phạm khỏi nhóm' })
  async removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: RemoveWorkspaceContentDto,
  ) {
    await this.admin.removeMember(user, id, memberId, dto.reason);
  }
}

import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, requireHumanId } from '@codementor/platform';
import type { AuthenticatedUser } from '@codementor/platform';
import { WorkspaceQuotaService } from '../application/workspace-quota.service';

/**
 * Must be registered before `WorkspaceController`, like the admin controller: otherwise
 * `workspaces/:slug` would capture `workspaces/plan-usage`.
 */
@ApiTags('Workspace quotas')
@ApiBearerAuth()
@Controller({ path: 'workspaces', version: '1' })
export class WorkspaceQuotaController {
  constructor(private readonly quota: WorkspaceQuotaService) {}

  @Get('plan-usage')
  @ApiOperation({ summary: 'Your plan limits and how much of them your owned groups use' })
  usage(@CurrentUser() user: AuthenticatedUser) {
    return this.quota.usage(requireHumanId(user));
  }

  @Get('plan-usage/admin-overview')
  @Roles('admin')
  @ApiOperation({ summary: 'Platform-wide Workspace storage and owners near their limits' })
  adminOverview() {
    return this.quota.adminOverview();
  }
}

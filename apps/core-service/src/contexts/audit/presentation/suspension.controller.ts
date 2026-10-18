import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@codementor/platform';
import { ReportModerationService } from '../application/report-moderation.service';

/**
 * Hạn mở khoá của một tài khoản đang bị khoá, để trang đăng nhập đếm ngược.
 *
 * Công khai vì người gọi chính là người KHÔNG đăng nhập được. Khoá tra là `sub` của Keycloak
 * chứ không phải email: chỉ BFF lấy được `sub` (qua API quản trị Keycloak), nên người ngoài
 * không dò được ai đang bị khoá bằng email. Trả về không có gì ngoài trạng thái và hạn.
 */
@ApiTags('reports')
@Controller({ path: 'system/suspensions', version: '1' })
export class SuspensionController {
  constructor(private readonly moderation: ReportModerationService) {}

  @Public()
  @Get(':externalId')
  @ApiOperation({ summary: 'Hạn mở khoá của tài khoản bị khoá (null = không thời hạn)' })
  status(@Param('externalId') externalId: string) {
    return this.moderation.suspensionOf(externalId);
  }
}

import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '@codementor/platform';
import { SystemService } from '../application/system.service';

/** Trang Hoạt động hệ thống và Cài đặt của admin. Chỉ đọc — không có đường ghi cấu hình. */
@ApiTags('system')
@ApiBearerAuth('access-token')
@Controller({ path: 'system', version: '1' })
@Roles('admin')
export class SystemController {
  constructor(private readonly system: SystemService) {}

  @Get('activity')
  @ApiOperation({ summary: 'Admin: sức khoẻ các service, outbox, consumer Kafka, email' })
  activity() {
    return this.system.activity();
  }

  @Get('settings')
  @ApiOperation({ summary: 'Admin: cấu hình nền tảng đang chạy, không kèm secret' })
  settings() {
    return this.system.settings();
  }
}

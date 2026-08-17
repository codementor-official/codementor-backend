import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '@codementor/platform';
import { AuditLogService } from '../application/audit-log.service';

export class ListAuditLogsQueryDto {
  @ApiPropertyOptional({ example: 'user' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  targetType?: string;

  @ApiPropertyOptional({ description: 'Khoá của đối tượng bị tác động' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  targetId?: string;

  @ApiPropertyOptional({ example: 'user.role_changed' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  action?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

/**
 * Nhật ký kiểm toán. Chỉ ĐỌC — không có endpoint tạo, sửa hay xoá.
 *
 * Nhật ký chỉ ghi thêm, và chỉ ghi từ bên trong use case thực hiện hành động. Mở một
 * đường HTTP cho phép ghi tay là mở luôn đường viết vào đó những dòng không tương ứng
 * với việc gì đã xảy ra thật, và khi đó bảng này mất sạch giá trị.
 */
@ApiTags('audit')
@ApiBearerAuth('access-token')
@Controller({ path: 'audit-logs', version: '1' })
export class AuditLogController {
  constructor(private readonly audit: AuditLogService) {}

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'Nhật ký hành động quản trị, mới nhất trước' })
  list(@Query() query: ListAuditLogsQueryDto) {
    return this.audit.list(query);
  }
}

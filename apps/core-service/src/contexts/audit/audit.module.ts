import { Global, Module } from '@nestjs/common';
import { AuditLogService } from './application/audit-log.service';
import { ModerationAuditConsumer } from './application/moderation-audit.consumer';
import { AuditLogController } from './presentation/audit-log.controller';

/**
 * Global vì bất kỳ context nào thực hiện một hành động quản trị cũng cần ghi lại nó, và
 * bắt mỗi context tự import module này là bắt người ta nhớ — mà quên ghi nhật ký thì
 * không có gì báo, chỉ là về sau thiếu mất một dòng.
 */
@Global()
@Module({
  controllers: [AuditLogController],
  providers: [AuditLogService, ModerationAuditConsumer],
  exports: [AuditLogService],
})
export class AuditModule {}

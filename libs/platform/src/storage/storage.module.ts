import { Global, Module } from '@nestjs/common';
import { ObjectStorageService } from './object-storage.service';

/**
 * `@Global` cùng lý do như `PrismaModule`: kho đối tượng là hạ tầng, không phải một
 * bounded context. Service nào cần ký một URL tải lên thì tiêm thẳng, không phải nối lại
 * import ở từng module nghiệp vụ.
 */
@Global()
@Module({
  providers: [ObjectStorageService],
  exports: [ObjectStorageService],
})
export class StorageModule {}

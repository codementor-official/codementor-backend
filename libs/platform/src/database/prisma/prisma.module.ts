import { Global, Module } from '@nestjs/common';
import { ContentAuthorLookup } from '../../auth/content-author.lookup';
import { PrismaService } from './prisma.service';

/**
 * `ContentAuthorLookup` đăng ký Ở ĐÂY, không phải trong `AuthModule`: nó chỉ cần đúng
 * một thứ — `PrismaService` — và mọi service dùng nó (learning, exercise) đều đã import
 * `PrismaModule`. Global nên không service nào phải tự khai lại provider này.
 */
@Global()
@Module({
  providers: [PrismaService, ContentAuthorLookup],
  exports: [PrismaService, ContentAuthorLookup],
})
export class PrismaModule {}

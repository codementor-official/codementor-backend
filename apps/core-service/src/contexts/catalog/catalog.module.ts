import { Module } from '@nestjs/common';
import { TagController } from './presentation/tag.controller';

/**
 * Từ vựng dùng chung: `technologies`, `tags`, `companies` (xem app.module.ts).
 *
 * Mới chỉ mở `tags` vì đó là thứ đang có người gọi. Thêm technologies/companies khi có
 * màn hình cần tới, không dựng sẵn.
 */
@Module({ controllers: [TagController] })
export class CatalogModule {}

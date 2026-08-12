import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

/**
 * MongoDB giữ phần nội dung có shape thay đổi: đề bài, thân bài học, chi tiết chấm,
 * hội thoại AI. Collection và validator do codementor-infra/database/mongo định nghĩa.
 */
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGO_URI'),
        dbName: config.get<string>('MONGO_DB', 'codementor'),
        autoIndex: false, // index do infra tạo, ứng dụng không tự đổi
      }),
    }),
  ],
  exports: [MongooseModule],
})
export class MongoModule {}

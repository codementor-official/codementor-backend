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

        /**
         * Đặt ở tầng kết nối, không phải từng lệnh ghi.
         *
         * DTO đi qua class-transformer nên mọi trường tuỳ chọn không được truyền vẫn
         * tồn tại với giá trị `undefined`. Mặc định driver serialize `undefined` thành
         * `null`, và mọi collection ở đây đều `validationLevel: strict` với `bsonType`
         * cụ thể — `generated: null` không phải `bool`, thế là cả lệnh ghi bị từ chối.
         *
         * Lọc tay ở tầng gốc của object không đủ: những trường đó nằm bên trong mảng
         * (`testCases[]`, `languages[]`). Và đặt cờ ở từng lời gọi thì lần sau ai viết
         * repository mới sẽ quên — đây là bẫy đã sập một lần với `exercise_contents`,
         * và `lesson_contents` sẽ có cùng hình dạng.
         *
         * Đánh đổi: không thể dùng `undefined` để xoá trường; muốn xoá thì `$unset`.
         */
        ignoreUndefined: true,
      }),
    }),
  ],
  exports: [MongooseModule],
})
export class MongoModule {}

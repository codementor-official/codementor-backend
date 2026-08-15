import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import type { ExerciseContent } from '../domain/model/exercise-content';
import type { ExerciseContentRepository } from '../domain/port/exercise.repository';

const COLLECTION = 'exercise_contents';

/**
 * Truy cập collection thẳng qua driver, không qua Mongoose model.
 *
 * Collection do codementor-infra sở hữu: nó đã có `$jsonSchema` validator ở mức `strict`
 * và bốn index. Khai một Mongoose schema song song sẽ tạo bản mô tả thứ hai cho cùng một
 * thứ, và `autoIndex` bị tắt nên schema đó cũng không tạo index — chỉ còn tác dụng làm
 * hai định nghĩa trôi khỏi nhau.
 */
@Injectable()
export class MongoExerciseContentRepository implements ExerciseContentRepository {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private get collection() {
    return this.connection.collection(COLLECTION);
  }

  async findByExerciseId(exerciseId: string): Promise<ExerciseContent | null> {
    const document = await this.collection.findOne(
      { exerciseId },
      { projection: { _id: 0, exerciseId: 0, kind: 0, createdAt: 0, updatedAt: 0 } },
    );
    return (document as ExerciseContent | null) ?? null;
  }

  /**
   * Trả về `_id` để gọi bên ngoài gán vào `exercises.content_ref`.
   *
   * `ignoreUndefined` là bắt buộc, không phải tối ưu. DTO đi qua class-transformer nên
   * mọi trường tuỳ chọn không được truyền vẫn tồn tại với giá trị `undefined`; driver
   * mặc định serialize `undefined` thành `null`, và validator từ chối vì `null` không
   * khớp `bsonType` đã khai (`generated: null` không phải `bool`). Lọc tay ở tầng gốc
   * không đủ — những trường đó nằm bên trong `testCases[]` và `languages[]`.
   */
  async upsert(exerciseId: string, kind: string, content: ExerciseContent): Promise<string> {
    const now = new Date();

    const result = await this.collection.findOneAndUpdate(
      { exerciseId },
      {
        $set: { ...content, kind, updatedAt: now },
        $setOnInsert: { exerciseId, createdAt: now },
      },
      { upsert: true, returnDocument: 'after', projection: { _id: 1 }, ignoreUndefined: true },
    );

    if (!result?._id) throw new Error(`Không ghi được nội dung cho exercise ${exerciseId}`);
    return result._id.toString();
  }

  async deleteByExerciseId(exerciseId: string): Promise<void> {
    await this.collection.deleteOne({ exerciseId });
  }
}

import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import type { LessonContent, LessonContentRepository } from '../domain/port/course.repository';

const COLLECTION = 'lesson_contents';

/**
 * Thân bài lý thuyết. `contentHtml` là HTML do TipTap sinh ra — trường này được thêm
 * vào validator ở đợt migration 0018; trước đó collection chỉ nhận `sections[].blocks[]`
 * và mọi lệnh ghi từ studio đều bị từ chối.
 */
@Injectable()
export class MongoLessonContentRepository implements LessonContentRepository {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private get collection() {
    return this.connection.collection(COLLECTION);
  }

  async findByLessonId(lessonId: string): Promise<LessonContent | null> {
    const document = await this.collection.findOne(
      { lessonId },
      { projection: { _id: 0, lessonId: 0, createdAt: 0, updatedAt: 0 } },
    );
    return (document as LessonContent | null) ?? null;
  }

  async upsert(lessonId: string, content: LessonContent): Promise<string> {
    const now = new Date();
    const result = await this.collection.findOneAndUpdate(
      { lessonId },
      { $set: { ...content, updatedAt: now }, $setOnInsert: { lessonId, createdAt: now } },
      { upsert: true, returnDocument: 'after', projection: { _id: 1 } },
    );
    if (!result?._id) throw new Error(`Không ghi được nội dung cho lesson ${lessonId}`);
    return result._id.toString();
  }
}

import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import type {
  ArticleContent,
  ArticleContentRepository,
} from '../domain/port/article.repository';

const COLLECTION = 'article_contents';

/**
 * Thân bài viết. `contentHtml` là HTML do RichTextEditor sinh ra — trường này được thêm
 * vào validator cùng lúc với module bài viết; trước đó collection chỉ nhận `sections[]`
 * và mọi lệnh ghi từ trình soạn thảo đều bị từ chối.
 */
@Injectable()
export class MongoArticleContentRepository implements ArticleContentRepository {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private get collection() {
    return this.connection.collection(COLLECTION);
  }

  async find(articleId: string): Promise<ArticleContent | null> {
    const document = await this.collection.findOne(
      { articleId },
      { projection: { _id: 0, contentHtml: 1 } },
    );
    const html = document?.contentHtml;
    return typeof html === 'string' ? { contentHtml: html } : null;
  }

  async save(articleId: string, content: ArticleContent): Promise<string> {
    const now = new Date();
    const result = await this.collection.findOneAndUpdate(
      { articleId },
      {
        $set: { contentHtml: content.contentHtml, updatedAt: now },
        $setOnInsert: { articleId, createdAt: now },
      },
      { upsert: true, returnDocument: 'after', projection: { _id: 1 } },
    );
    if (!result?._id) throw new Error(`Không ghi được nội dung cho bài viết ${articleId}`);
    return result._id.toString();
  }

  async delete(articleId: string): Promise<void> {
    await this.collection.deleteOne({ articleId });
  }
}

import type { Article } from '../model/article';

export interface ArticleListFilter {
  status?: string;
  q?: string;
  /** Chỉ bài đang chờ duyệt — hàng chờ của admin. */
  pendingOnly?: boolean;
  /** Chỉ bài đã công khai — đường đọc của người học. */
  publishedOnly: boolean;
  /** Giới hạn theo tác giả. Giảng viên chỉ được thấy bài của chính mình. */
  authorId?: string;
  /** Tên chủ đề, dùng cho dãy chip "xem theo chủ đề" ở trang bài viết. */
  tag?: string;
  limit: number;
  cursor?: { updatedAt: Date; id: string };
}

export interface ArticleListItem {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  status: string;
  readMinutes: number | null;
  authorId: string | null;
  /** Lấy kèm bằng LEFT JOIN `users`, cùng cách `findMany` của khóa học đang làm. */
  authorName: string | null;
  tagName: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  rejectionReason: string | null;
}

/**
 * Thân bài do trình soạn thảo sinh ra, ở dạng HTML.
 *
 * Dùng `contentHtml` chứ không phải mảng `sections` có cấu trúc: RichTextEditor trả HTML,
 * và ép nó về khối có kiểu rồi dựng lại sẽ mất định dạng ở cả hai chiều. Cùng lựa chọn
 * mà `lesson_contents` đã làm.
 */
export interface ArticleContent {
  contentHtml: string;
}

export interface ArticleRepository {
  findById(id: string): Promise<Article | null>;
  findBySlug(slug: string): Promise<Article | null>;
  existsBySlug(slug: string): Promise<boolean>;
  list(filter: ArticleListFilter): Promise<ArticleListItem[]>;
  /**
   * Tên tác giả và chủ đề cho trang chi tiết. Tách khỏi `findById` vì chúng KHÔNG thuộc
   * aggregate `Article` — chúng nằm ở `users` và `tags`, và nhét vào entity sẽ biến một
   * thứ chỉ để hiển thị thành trạng thái mà aggregate phải giữ đúng.
   */
  describe(articleId: string): Promise<{ authorName: string | null; tagName: string | null }>;
  save(article: Article): Promise<void>;
  delete(id: string): Promise<void>;
  /** Đếm theo trạng thái, cho trang tổng quan của admin. */
  countByStatus(authorId?: string): Promise<Record<string, number>>;
  /** Chủ đề của các bài ĐÃ công khai, kèm số bài — nguồn cho dãy chip lọc. */
  publishedTags(): Promise<{ name: string; count: number }[]>;
  /** Số bài đang chờ duyệt — cho chấm đỏ ở hàng chờ của admin. */
  pendingCount(): Promise<number>;
}

/**
 * Thân bài trong MongoDB. Tách khỏi `ArticleRepository` vì hai kho khác nhau: đổi cách
 * lưu nội dung không được kéo theo việc sửa repository của bảng quan hệ.
 */
export interface ArticleContentRepository {
  find(articleId: string): Promise<ArticleContent | null>;
  /** Trả `_id` của tài liệu để gắn vào `articles.content_ref`. */
  save(articleId: string, content: ArticleContent): Promise<string>;
  delete(articleId: string): Promise<void>;
}

export const ARTICLE_REPOSITORY = Symbol('ARTICLE_REPOSITORY');
export const ARTICLE_CONTENT_REPOSITORY = Symbol('ARTICLE_CONTENT_REPOSITORY');

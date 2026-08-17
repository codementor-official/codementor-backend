import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, mapDatabaseError } from '@codementor/platform';
import { Article } from '../domain/model/article';
import type { ContentStatus } from '../domain/model/roadmap';
import type {
  ArticleListFilter,
  ArticleListItem,
  ArticleRepository,
} from '../domain/port/article.repository';

interface ArticleRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  takeaway: string | null;
  author_id: string | null;
  tag_id: string | null;
  read_minutes: number | null;
  status: string;
  content_ref: string | null;
  rejection_reason: string | null;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class PrismaArticleRepository implements ArticleRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Article | null> {
    const rows = await this.prisma.$queryRaw<ArticleRow[]>`
      SELECT id, slug::text AS slug, title, excerpt, takeaway, author_id, tag_id,
             read_minutes, status::text AS status, content_ref, rejection_reason,
             published_at, created_at, updated_at
      FROM articles WHERE id = ${id}::uuid LIMIT 1`;
    return rows[0] ? toEntity(rows[0]) : null;
  }

  async findBySlug(slug: string): Promise<Article | null> {
    const rows = await this.prisma.$queryRaw<ArticleRow[]>`
      SELECT id, slug::text AS slug, title, excerpt, takeaway, author_id, tag_id,
             read_minutes, status::text AS status, content_ref, rejection_reason,
             published_at, created_at, updated_at
      FROM articles WHERE slug = ${slug}::citext LIMIT 1`;
    return rows[0] ? toEntity(rows[0]) : null;
  }

  async existsBySlug(slug: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ one: number }[]>`
      SELECT 1 AS one FROM articles WHERE slug = ${slug}::citext LIMIT 1`;
    return rows.length > 0;
  }

  async list(filter: ArticleListFilter): Promise<ArticleListItem[]> {
    const where: Prisma.Sql[] = [];
    if (filter.publishedOnly) where.push(Prisma.sql`a.status = 'published'`);
    if (filter.pendingOnly) where.push(Prisma.sql`a.status = 'pending_review'`);
    if (filter.status) where.push(Prisma.sql`a.status = ${filter.status}::content_status`);
    if (filter.authorId) where.push(Prisma.sql`a.author_id = ${filter.authorId}::uuid`);
    if (filter.tag) where.push(Prisma.sql`t.name = ${filter.tag}`);
    if (filter.q?.trim()) {
      const term = `%${filter.q.trim().toLowerCase()}%`;
      where.push(Prisma.sql`(lower(a.title) LIKE ${term} OR a.slug::text ILIKE ${term})`);
    }
    if (filter.cursor) {
      where.push(
        Prisma.sql`(a.updated_at, a.id) < (${filter.cursor.updatedAt}::timestamptz, ${filter.cursor.id}::uuid)`,
      );
    }
    const clause = where.length > 0 ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;

    return this.prisma.$queryRaw<ArticleListItem[]>`
      SELECT a.id, a.slug::text AS slug, a.title, a.excerpt, a.status::text AS status,
             a.read_minutes AS "readMinutes", a.author_id AS "authorId",
             u.display_name AS "authorName", t.name AS "tagName",
             a.published_at AS "publishedAt", a.created_at AS "createdAt",
             a.updated_at AS "updatedAt", a.rejection_reason AS "rejectionReason"
      FROM articles a
      LEFT JOIN users u ON u.id = a.author_id
      LEFT JOIN tags t ON t.id = a.tag_id
      ${clause}
      ORDER BY a.updated_at DESC, a.id DESC
      LIMIT ${filter.limit + 1}`;
  }

  async pendingCount(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM articles WHERE status = 'pending_review'`;
    return Number(rows[0]?.count ?? 0);
  }

  async publishedTags(): Promise<{ name: string; count: number }[]> {
    const rows = await this.prisma.$queryRaw<{ name: string; count: bigint }[]>`
      SELECT t.name, count(*) AS count
      FROM articles a JOIN tags t ON t.id = a.tag_id
      WHERE a.status = 'published'
      GROUP BY t.name ORDER BY count(*) DESC, t.name`;
    return rows.map((row) => ({ name: row.name, count: Number(row.count) }));
  }

  async describe(articleId: string): Promise<{ authorName: string | null; tagName: string | null }> {
    const rows = await this.prisma.$queryRaw<{ authorName: string | null; tagName: string | null }[]>`
      SELECT u.display_name AS "authorName", t.name AS "tagName"
      FROM articles a
      LEFT JOIN users u ON u.id = a.author_id
      LEFT JOIN tags t ON t.id = a.tag_id
      WHERE a.id = ${articleId}::uuid`;
    return rows[0] ?? { authorName: null, tagName: null };
  }

  async save(article: Article): Promise<void> {
    try {
      // `created_at` chỉ đặt lúc chèn: UPDATE ghi đè nó sẽ làm mất ngày tạo thật.
      await this.prisma.$executeRaw`
        INSERT INTO articles (id, slug, title, excerpt, takeaway, author_id, tag_id,
                              read_minutes, status, content_ref, rejection_reason,
                              published_at, created_at, updated_at)
        VALUES (${article.id}::uuid, ${article.slug}::citext, ${article.title},
                ${article.excerpt}, ${article.takeaway},
                ${article.authorId}::uuid, ${article.tagId}::uuid,
                ${article.readMinutes}, ${article.status}::content_status,
                ${article.contentRef}, ${article.rejectionReason}, ${article.publishedAt},
                ${article.createdAt}, ${article.updatedAt})
        ON CONFLICT (id) DO UPDATE SET
          slug = EXCLUDED.slug, title = EXCLUDED.title, excerpt = EXCLUDED.excerpt,
          takeaway = EXCLUDED.takeaway, tag_id = EXCLUDED.tag_id,
          read_minutes = EXCLUDED.read_minutes, status = EXCLUDED.status,
          content_ref = EXCLUDED.content_ref, rejection_reason = EXCLUDED.rejection_reason,
          published_at = EXCLUDED.published_at,
          updated_at = EXCLUDED.updated_at`;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async delete(id: string): Promise<void> {
    await this.prisma.$executeRaw`DELETE FROM articles WHERE id = ${id}::uuid`;
  }

  async countByStatus(): Promise<Record<string, number>> {
    const rows = await this.prisma.$queryRaw<{ status: string; count: bigint }[]>`
      SELECT status::text AS status, count(*) AS count FROM articles GROUP BY status`;
    // `count(*)` về đây là bigint và JSON.stringify sẽ nổ nếu để nguyên.
    return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
  }
}

function toEntity(row: ArticleRow): Article {
  return Article.rehydrate(row.id, {
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    takeaway: row.takeaway,
    authorId: row.author_id,
    tagId: row.tag_id,
    readMinutes: row.read_minutes,
    status: row.status as ContentStatus,
    contentRef: row.content_ref,
    rejectionReason: row.rejection_reason,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

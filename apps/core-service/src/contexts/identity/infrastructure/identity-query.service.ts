import { Injectable } from '@nestjs/common';
import { PrismaService } from '@codementor/platform';
import type { IdentityQuery, UserSummary } from '../identity.public';

/** Hiện thực cổng đọc công khai cho context khác. Chỉ đọc, không cho mutate. */
@Injectable()
export class IdentityQueryService implements IdentityQuery {
  constructor(private readonly prisma: PrismaService) {}

  async getUserSummary(userId: string): Promise<UserSummary | null> {
    const rows = await this.prisma.$queryRaw<UserSummary[]>`
      SELECT id, email, display_name AS "displayName", role
      FROM users WHERE id = ${userId}::uuid AND status <> 'deleted' LIMIT 1`;
    return rows[0] ?? null;
  }

  async getUserSummaries(userIds: string[]): Promise<UserSummary[]> {
    if (userIds.length === 0) return [];
    return this.prisma.$queryRaw<UserSummary[]>`
      SELECT id, email, display_name AS "displayName", role
      FROM users WHERE id = ANY(${userIds}::uuid[]) AND status <> 'deleted'`;
  }
}

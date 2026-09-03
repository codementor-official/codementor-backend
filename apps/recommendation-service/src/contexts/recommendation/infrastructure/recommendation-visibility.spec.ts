import { Prisma } from '@prisma/client';
import type { PrismaService } from '@codementor/platform';
import { PrismaCandidateRepository } from './prisma-candidate.repository';
import { PrismaCourseRepository } from '../../../../../learning-service/src/contexts/learning/infrastructure/prisma-course.repository';
import { PrismaWorkspaceRepository } from '../../../../../workspace-service/src/contexts/workspace/infrastructure/prisma-workspace.repository';

// Repository query tests do not exercise remote JWT key discovery.
jest.mock('jwks-rsa', () => ({ passportJwtSecret: jest.fn() }));

describe('recommendation visibility and targeted metadata', () => {
  const ids = ['41000000-0000-4000-8000-000000000001'];
  let queries: Prisma.Sql[];
  let db: PrismaService;
  beforeEach(() => {
    queries = [];
    db = { $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      queries.push(Prisma.sql(strings, ...values));
      return [];
    } } as unknown as PrismaService;
  });

  it('keeps published-only restrictions when hydrating exact course IDs', async () => {
    await new PrismaCourseRepository(db).list({ createdBy: null, publishedOnly: true, ids, limit: 20 });
    expect(queries[0].sql).toContain("c.status = 'published'");
    expect(queries[0].sql).toContain('c.id = ANY(');
    expect(queries[0].values).toContainEqual(ids);
  });

  it('public exercise candidates cannot include workspace-private exercises', async () => {
    await new PrismaCandidateRepository(db).listExercises('user', true);
    expect(queries[0].sql).toContain("e.status = 'published' AND e.visibility = 'public'");
  });

  it('source IDs cannot read private exercise or unpublished article tags', async () => {
    const repository = new PrismaCandidateRepository(db);
    await repository.findExerciseTags(ids[0]);
    await repository.findArticleTags(ids[0]);
    expect(queries[0].sql).toContain("e.visibility = 'public'");
    expect(queries[1].sql).toContain("a.status = 'published'");
  });

  it('group recommendation excludes private and archived groups', async () => {
    await new PrismaCandidateRepository(db).listGroups('user', true);
    expect(queries[0].sql).toContain("g.status = 'active' AND g.privacy = 'public'");
  });

  it('targeted discovery intersects IDs with public active non-membership scope', async () => {
    const findMany = jest.fn(async () => []);
    const prisma = {
      study_groups: { count: async () => 0, findMany },
      group_members: { findMany: async () => [] },
      assignments: { findMany: async () => [] },
      group_exercises: { findMany: async () => [] },
    } as unknown as PrismaService;
    await new PrismaWorkspaceRepository(prisma).listForUser('viewer', { scope: 'discover', ids, page: 1, limit: 20 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      id: { in: ids }, status: 'active', privacy: 'public',
      NOT: { group_members: { some: { user_id: 'viewer', status: 'active' } } },
    }) }));
  });
});

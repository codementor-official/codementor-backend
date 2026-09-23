import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ExerciseSolutionsController } from './exercise-solutions.controller';
import type { AuthenticatedUser, PrismaService } from '@codementor/platform';

jest.mock('@codementor/platform', () => ({
  PrismaService: class {},
  CurrentUser: () => () => undefined,
  requireHumanId: (user: { id: string }) => user.id,
}));

const exerciseId = '11111111-1111-4111-8111-111111111111';
const solutionId = '22222222-2222-4222-8222-222222222222';
const authorId = '33333333-3333-4333-8333-333333333333';
const otherId = '44444444-4444-4444-8444-444444444444';
const user = (id: string) => ({ id, actorType: 'human' }) as AuthenticatedUser;

describe('ExerciseSolutionsController scope and ownership', () => {
  const prisma = { $queryRaw: jest.fn(), $executeRaw: jest.fn() };
  const controller = new ExerciseSolutionsController(prisma as unknown as PrismaService);

  beforeEach(() => jest.resetAllMocks());

  it('does not list solutions for an exercise outside the public published code bank', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await expect(controller.list(user(authorId), exerciseId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = prisma.$queryRaw.mock.calls[0][0].join(' ');
    expect(sql).toContain("visibility = 'public'");
    expect(sql).toContain("status = 'published'");
    expect(sql).toContain("kind = 'code'");
  });

  it('does not create a solution for a private exercise', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await expect(
      controller.create(user(authorId), exerciseId, {
        title: 'Cách giải',
        explanation: 'Giải thích đủ dài',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns a bounded page with total and language filters for a public exercise', async () => {
    const rows = Array.from({ length: 11 }, (_, index) => ({ id: `solution-${index}` }));
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: exerciseId }])
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce([{ total: 12 }])
      .mockResolvedValueOnce([{ language: 'Python', count: 12 }]);
    const result = await controller.list(user(authorId), exerciseId, '1', 'popular', 'binary', 'Python');
    expect(result.items).toHaveLength(10);
    expect(result).toMatchObject({ page: 1, hasMore: true, total: 12 });
    expect(result.languages).toEqual([{ language: 'Python', count: 12 }]);
  });

  it('does not allow votes on private exercises', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await expect(controller.vote(user(authorId), exerciseId, solutionId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('rejects edits by someone other than the author', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: exerciseId }])
      .mockResolvedValueOnce([{ id: solutionId, author_id: authorId }]);
    await expect(
      controller.edit(user(otherId), exerciseId, solutionId, {
        title: 'Cách giải',
        explanation: 'Giải thích đủ dài',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});

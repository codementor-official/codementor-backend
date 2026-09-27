import type { PrismaService } from '@codementor/platform';
import { PrismaExerciseRepository } from './prisma-exercise.repository';

jest.mock('@codementor/platform', () => ({
  PrismaService: class {},
  mapDatabaseError: (error: unknown) => error,
}));

describe('PrismaExerciseRepository.adminSummary', () => {
  it('đếm trạng thái trên mọi bài, còn độ khó và xin gỡ chỉ trên bài công khai', async () => {
    const rows = [
      { status: 'published', difficulty: 'easy', count: 5, removal: 1 },
      { status: 'published', difficulty: 'hard', count: 2, removal: 0 },
      { status: 'draft', difficulty: 'easy', count: 3, removal: 0 },
      // Bài bị từ chối cũng có `rejection_reason` — không được tính là xin gỡ.
      { status: 'rejected', difficulty: 'medium', count: 4, removal: 4 },
    ];
    const prisma = { $queryRaw: jest.fn().mockResolvedValue(rows) } as unknown as PrismaService;

    await expect(new PrismaExerciseRepository(prisma).adminSummary()).resolves.toEqual({
      byStatus: { published: 7, draft: 3, rejected: 4 },
      byDifficulty: { easy: 5, hard: 2 },
      removalRequested: 1,
    });
  });
});

// Barrel của platform/messaging nạp jwks-rsa (ESM) — jest không chạy được; use case chỉ cần hai thứ này.
jest.mock('@codementor/platform', () => ({ requireHumanId: (user: { id: string }) => user.id }));
jest.mock('@codementor/messaging', () => ({ EVENT_BUS: Symbol('EVENT_BUS') }));

import type { AuthenticatedUser } from '@codementor/platform';
import type {
  ExerciseGradingPort,
  JudgePort,
  WorkspaceAssignmentPort,
} from '../domain/grading.port';
import type { JudgeResult, SubmissionRecord } from '../domain/submission';
import type { SubmissionRepository } from '../domain/submission.repository';
import { CreateSubmissionUseCase } from './submission.usecases';

const HIDDEN_EXPECTED = '918273645';

function record(overrides: Partial<SubmissionRecord> = {}): SubmissionRecord {
  return {
    id: 'sub-1',
    userId: 'user-1',
    exerciseId: '00000000-0000-4000-8000-000000000001',
    assignmentId: null,
    language: 'python',
    sourceCode: 'def f(n): return n',
    verdict: 'pending',
    score: null,
    passedTests: null,
    totalTests: null,
    runtimeMs: null,
    memoryKb: null,
    attemptNumber: 1,
    isLate: false,
    runDetailRef: null,
    submittedAt: new Date('2026-11-10T00:00:00Z'),
    ...overrides,
  } as SubmissionRecord;
}

describe('CreateSubmissionUseCase', () => {
  const judgeResult: JudgeResult = {
    verdict: 'wrong_answer',
    score: 50,
    passedTests: 1,
    totalTests: 2,
    runtimeMs: 4,
    memoryKb: 100,
    cases: [
      {
        order: 1,
        verdict: 'accepted',
        expected: '21',
        actual: '21',
        stderr: '',
        runtimeMs: 2,
        memoryKb: 100,
      },
      {
        order: 2,
        verdict: 'wrong_answer',
        expected: HIDDEN_EXPECTED,
        actual: '546372819',
        stderr: 'hidden stderr',
        runtimeMs: 2,
        memoryKb: 100,
      },
    ],
  };
  const judge: JudgePort = { run: jest.fn().mockResolvedValue(judgeResult) };
  const grading: ExerciseGradingPort = {
    getSnapshot: jest.fn().mockResolvedValue({
      id: 'ex-1',
      xpReward: 10,
      timeLimitMs: 1000,
      memoryLimitKb: 65536,
      content: {
        languages: [{ id: 'python', label: 'Python' }],
        testCases: [
          { order: 1, args: [12], expected: 21, visibility: 'public' },
          { order: 2, args: [546372819], expected: 918273645, visibility: 'hidden' },
        ],
      },
    }),
  };
  const submissions = {
    hasAccepted: jest.fn().mockResolvedValue(false),
    createPending: jest.fn().mockResolvedValue(record()),
    complete: jest.fn().mockResolvedValue(record({ verdict: 'wrong_answer', score: 50 })),
  } as unknown as SubmissionRepository;
  const useCase = new CreateSubmissionUseCase(
    submissions,
    grading,
    judge,
    {} as WorkspaceAssignmentPort,
    { publish: jest.fn() } as never,
  );
  const user = { id: 'user-1', kind: 'human' } as unknown as AuthenticatedUser;

  it('phản hồi cho học viên không chứa expected, actual hay stderr của test ẩn', async () => {
    const response = await useCase.execute(
      user,
      { exerciseId: record().exerciseId, language: 'python', sourceCode: 'x' },
      'Bearer t',
    );

    expect(JSON.stringify(response)).not.toContain(HIDDEN_EXPECTED);
    expect(JSON.stringify(response)).not.toContain('hidden stderr');
    expect(response.cases).toEqual([
      judgeResult.cases[0],
      { order: 2, verdict: 'wrong_answer', hidden: true, runtimeMs: 2, memoryKb: 100 },
    ]);
  });

  it('vẫn lưu bản đầy đủ cho người ra đề', async () => {
    await useCase.execute(
      user,
      { exerciseId: record().exerciseId, language: 'python', sourceCode: 'x' },
      'Bearer t',
    );
    expect(submissions.complete).toHaveBeenCalledWith('sub-1', judgeResult);
  });
});

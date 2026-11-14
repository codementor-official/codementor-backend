// Barrel của platform/messaging nạp jwks-rsa (ESM) — jest không chạy được; use case chỉ cần hai thứ này.
jest.mock('@codementor/platform', () => ({ requireHumanId: (user: { id: string }) => user.id }));
jest.mock('@codementor/messaging', () => ({ EVENT_BUS: Symbol('EVENT_BUS') }));

import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { TOPICS } from '@codementor/contracts';
import type { AuthenticatedUser } from '@codementor/platform';
import type {
  ExerciseGradingPort,
  JudgePort,
  WorkspaceAssignmentPort,
} from '../domain/grading.port';
import type { JudgeResult, SubmissionRecord } from '../domain/submission';
import type { SubmissionRepository } from '../domain/submission.repository';
import { CreateSubmissionUseCase, StuckSubmissionSweeper } from './submission.usecases';

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
    failPending: jest.fn().mockResolvedValue(undefined),
  } as unknown as SubmissionRepository;
  const events = { publish: jest.fn() };
  const useCase = new CreateSubmissionUseCase(
    submissions,
    grading,
    judge,
    {} as WorkspaceAssignmentPort,
    events as never,
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

  // TC-19: mất kết nối judge thì học viên nhận 503 và bài nộp chuyển `system_error`,
  // không kẹt `pending`, không phát SUBMISSION_EVALUATED (không cộng XP, không tính lượt).
  it('TC-19: mất kết nối judge thì báo 503 và bài nộp chuyển system_error, không kẹt pending', async () => {
    (submissions.createPending as jest.Mock).mockClear();
    (submissions.complete as jest.Mock).mockClear();
    (submissions.failPending as jest.Mock).mockClear();
    (events.publish as jest.Mock).mockClear();
    (judge.run as jest.Mock).mockRejectedValueOnce(
      new ServiceUnavailableException('Không kết nối được judge-service'),
    );

    await expect(
      useCase.execute(
        user,
        { exerciseId: record().exerciseId, language: 'python', sourceCode: 'x' },
        'Bearer t',
      ),
    ).rejects.toMatchObject({ status: 503, message: expect.stringContaining('không bị tính lượt') });
    expect(submissions.createPending).toHaveBeenCalledTimes(1);
    expect(submissions.failPending).toHaveBeenCalledWith('sub-1');
    expect(submissions.complete).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalledWith(TOPICS.SUBMISSION_EVALUATED, expect.anything());
  });

  it('judge từ chối dữ liệu (400) thì giữ nguyên lỗi 400 và vẫn không để bài kẹt pending', async () => {
    (submissions.failPending as jest.Mock).mockClear();
    (judge.run as jest.Mock).mockRejectedValueOnce(new BadRequestException('Mã nguồn quá lớn'));

    await expect(
      useCase.execute(
        user,
        { exerciseId: record().exerciseId, language: 'python', sourceCode: 'x' },
        'Bearer t',
      ),
    ).rejects.toMatchObject({ status: 400, message: 'Mã nguồn quá lớn' });
    expect(submissions.failPending).toHaveBeenCalledWith('sub-1');
  });
});

describe('StuckSubmissionSweeper', () => {
  it('chuyển bài pending quá 10 phút sang system_error và không ném lỗi khi DB lỗi', async () => {
    const repo = {
      sweepStuckPending: jest.fn().mockResolvedValueOnce(2).mockRejectedValueOnce(new Error('db down')),
    } as unknown as SubmissionRepository;
    const sweeper = new StuckSubmissionSweeper(repo);
    await expect(sweeper.sweep()).resolves.toBe(2);
    expect(repo.sweepStuckPending).toHaveBeenCalledWith(10);
    await expect(sweeper.sweep()).resolves.toBe(0);
  });
});

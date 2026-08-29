export type SubmissionVerdict =
  | 'pending'
  | 'accepted'
  | 'wrong_answer'
  | 'compile_error'
  | 'runtime_error'
  | 'timeout'
  | 'memory_exceeded';

export interface SubmissionRecord {
  id: string;
  userId: string;
  exerciseId: string;
  assignmentId: string | null;
  language: string;
  sourceCode: string;
  verdict: SubmissionVerdict;
  score: number | null;
  passedTests: number | null;
  totalTests: number | null;
  runtimeMs: number | null;
  memoryKb: number | null;
  attemptNumber: number;
  isLate: boolean;
  runDetailRef: string | null;
  submittedAt: Date;
}

export interface JudgeResult {
  verdict: Exclude<SubmissionVerdict, 'pending'>;
  score: number;
  passedTests: number;
  totalTests: number;
  runtimeMs: number;
  memoryKb: number;
  runDetailRef?: string | null;
  compileOutput?: string | null;
  consoleOutput?: string;
  cases: Array<{
    order: number;
    verdict: string;
    expected: string;
    actual: string;
    stderr: string;
    runtimeMs: number;
    memoryKb: number;
  }>;
}

import type { JudgeResult } from './submission';

export interface GradingSnapshot {
  id: string;
  xpReward: number;
  timeLimitMs: number;
  memoryLimitKb: number;
  content: {
    ioMode?: 'stdin_stdout' | 'function';
    signature?: {
      functionName: string;
      parameters: Array<{ name: string; type: Record<string, unknown> }>;
      returnType: Record<string, unknown>;
    };
    testCases?: Array<{
      order: number;
      input?: string;
      args?: unknown[];
      expected?: unknown;
      weight?: number;
    }>;
    languages?: Array<{ id: string; label: string }>;
    evaluation?: {
      checker?: 'exact' | 'trimmed' | 'float' | 'custom' | 'unordered';
      floatTolerance?: number;
      stopOnFirstFailure?: boolean;
    };
  };
}

export interface ExerciseGradingPort {
  getSnapshot(exerciseId: string, authorization: string): Promise<GradingSnapshot>;
}

export interface AssignmentSubmissionContext {
  assignmentId: string;
  exerciseId: string;
  dueAt: string | null;
  attemptLimit: number | null;
  allowRetry: boolean;
  allowLateSubmission: boolean;
  submissionCount: number;
}

export interface WorkspaceAssignmentPort {
  getContext(assignmentId: string, authorization: string): Promise<AssignmentSubmissionContext | null>;
}

export interface JudgePort {
  run(input: {
    authorization: string;
    submissionId: string;
    language: string;
    sourceCode: string;
    timeLimitMs: number;
    memoryLimitKb: number;
    spec?: {
      functionName: string;
      parameters: Array<{ name: string; type: Record<string, unknown> }>;
      returnType: Record<string, unknown>;
      judgeMode: 'exact' | 'float' | 'unordered';
      judgeConfig?: { absEps?: number; relEps?: number };
    };
    testCases: Array<{
      order: number;
      input?: string;
      args?: unknown[];
      expected?: unknown;
      weight: number;
    }>;
    context?: { courseId: string; lessonId: string; exerciseId: string };
  }): Promise<JudgeResult>;
}

export const EXERCISE_GRADING_PORT = Symbol('EXERCISE_GRADING_PORT');
export const JUDGE_PORT = Symbol('JUDGE_PORT');
export const WORKSPACE_ASSIGNMENT_PORT = Symbol('WORKSPACE_ASSIGNMENT_PORT');

import type { JudgeResult, SubmissionRecord } from './submission';

export interface CreateSubmissionInput {
  userId: string;
  exerciseId: string;
  assignmentId: string | null;
  language: string;
  sourceCode: string;
  isLate: boolean;
}

export interface SubmissionPage {
  items: SubmissionRecord[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface SubmissionRepository {
  createPending(input: CreateSubmissionInput): Promise<SubmissionRecord>;
  complete(id: string, result: JudgeResult): Promise<SubmissionRecord>;
  findOwned(id: string, userId: string): Promise<SubmissionRecord | null>;
  listOwned(userId: string, exerciseId: string | undefined, page: number, limit: number): Promise<SubmissionPage>;
  hasAccepted(userId: string, exerciseId: string): Promise<boolean>;
}

export const SUBMISSION_REPOSITORY = Symbol('SUBMISSION_REPOSITORY');

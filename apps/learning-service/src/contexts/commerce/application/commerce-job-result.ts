export type CommerceJobName = 'payments' | 'refunds' | 'expiry' | 'income' | 'payouts';
export interface CommerceJobStage {
  name: CommerceJobName;
  selected: number;
  completed: number;
  waiting: number;
  failed: number;
  error?: string;
  items: { id: string; outcome: 'completed' | 'waiting' | 'failed'; status?: string }[];
}
export interface CommerceJobRun {
  runId: string;
  startedAt: string;
  finishedAt: string;
  status: 'completed' | 'partial' | 'already_running';
  processed: boolean;
  stages: CommerceJobStage[];
  releasedAmountVnd: number;
  debtOffsetVnd: number;
  remaining: { holding: number; refundBlocked: number; unverified: number; eligible: number } | null;
  /** Read-only snapshot after this run; null means diagnostics were unavailable. */
  orderReport?: CommerceJobOrderReport | null;
}

export interface CommerceJobOrder {
  id: string;
  courseTitle: string;
  instructorName: string;
  buyerName: string;
  amountVnd: number;
  instructorAmountVnd: number;
  releasedAmountVnd: number;
  debtOffsetVnd: number;
  status: string;
  incomeState: string;
  reason: 'released' | 'available' | 'refund' | 'verification' | 'holding' | 'eligible' | 'review' | 'not_paid';
  holdUntil: string | null;
  verifiedAt: string | null;
  nextVerificationAt: string | null;
  verificationDeferred: boolean;
  encounteredError: boolean;
}
export interface CommerceJobOrderReport {
  items: CommerceJobOrder[];
  total: number;
  page: number;
  limit: number;
  capturedAt: string;
}

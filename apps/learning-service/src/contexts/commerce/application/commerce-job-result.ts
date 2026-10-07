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
}

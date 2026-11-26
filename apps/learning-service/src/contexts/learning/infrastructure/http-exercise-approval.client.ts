import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessRuleViolation } from '@codementor/kernel';
import type { ExerciseApprovalPort } from '../domain/port/exercise-approval.port';

@Injectable()
export class HttpExerciseApprovalClient implements ExerciseApprovalPort {
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('EXERCISE_SERVICE_URL', 'http://localhost:3003');
  }

  async approve(exerciseId: string, authorization: string): Promise<void> {
    let response: Response;
    try {
      response = await fetch(
        `${this.baseUrl}/api/v1/exercises/${encodeURIComponent(exerciseId)}/approve-with-course`,
        { method: 'POST', headers: { Authorization: authorization }, signal: AbortSignal.timeout(5000) },
      );
    } catch {
      throw new ServiceUnavailableException('Không kết nối được exercise-service');
    }
    if (response.ok) return;
    const body = (await response.json().catch(() => null)) as
      | { message?: string; error?: { message?: string } }
      | null;
    throw new BusinessRuleViolation(body?.error?.message ?? body?.message ?? `HTTP ${response.status}`);
  }
}

import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ExerciseGradingPort,
  GradingSnapshot,
  JudgePort,
  WorkspaceAssignmentPort,
  AssignmentSubmissionContext,
} from '../domain/grading.port';
import type { JudgeResult } from '../domain/submission';

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; error?: { message?: string } };
    return body.error?.message ?? body.message ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

function localToken(config: ConfigService): string {
  const configured = config.get<string>('INTERNAL_SERVICE_TOKEN');
  if (configured) return configured;
  if (config.get<string>('NODE_ENV') !== 'production') return 'codementor-local-internal-token';
  throw new ServiceUnavailableException('Thiếu INTERNAL_SERVICE_TOKEN');
}

@Injectable()
export class HttpExerciseGradingClient implements ExerciseGradingPort {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('EXERCISE_SERVICE_URL', 'http://localhost:3003');
    this.token = localToken(config);
  }

  async getSnapshot(exerciseId: string, authorization: string): Promise<GradingSnapshot> {
    let response: Response;
    try {
      response = await fetch(
        `${this.baseUrl}/api/v1/exercises/${encodeURIComponent(exerciseId)}/grading-content`,
        {
          headers: {
            Authorization: authorization,
            'x-internal-service-token': this.token,
          },
          signal: AbortSignal.timeout(5000),
        },
      );
    } catch {
      throw new ServiceUnavailableException('Không kết nối được exercise-service');
    }
    if (response.status === 404) throw new NotFoundException('Bài tập không tồn tại hoặc chưa công khai');
    if (!response.ok) throw new BadGatewayException(await readError(response));
    return ((await response.json()) as { data: GradingSnapshot }).data;
  }
}

@Injectable()
export class HttpJudgeClient implements JudgePort {
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('JUDGE_SERVICE_URL', 'http://localhost:3007');
  }

  async run(input: Parameters<JudgePort['run']>[0]): Promise<JudgeResult> {
    const { authorization, ...payload } = input;
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/v1/judge/run`, {
        method: 'POST',
        headers: { Authorization: authorization, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(70_000),
      });
    } catch {
      throw new ServiceUnavailableException('Không kết nối được judge-service');
    }
    if (response.status === 400 || response.status === 413 || response.status === 422) {
      throw new BadRequestException(await readError(response));
    }
    if (!response.ok) throw new BadGatewayException(await readError(response));
    return ((await response.json()) as { data: JudgeResult }).data;
  }
}

@Injectable()
export class HttpWorkspaceAssignmentClient implements WorkspaceAssignmentPort {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('WORKSPACE_SERVICE_URL', 'http://localhost:3004');
    this.token = localToken(config);
  }

  async getContext(
    assignmentId: string,
    authorization: string,
  ): Promise<AssignmentSubmissionContext | null> {
    let response: Response;
    try {
      response = await fetch(
        `${this.baseUrl}/api/v1/workspaces/internal/assignments/${encodeURIComponent(assignmentId)}/submission-context`,
        {
          headers: { Authorization: authorization, 'x-internal-service-token': this.token },
          signal: AbortSignal.timeout(5000),
        },
      );
    } catch {
      throw new ServiceUnavailableException('Không kết nối được workspace-service');
    }
    if (!response.ok) throw new BadGatewayException(await readError(response));
    return ((await response.json()) as { data: AssignmentSubmissionContext | null }).data;
  }
}

import { HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiScope } from '@codementor/contracts';

@Injectable()
export class WorkspaceAiClient {
  constructor(private readonly config: ConfigService) {}
  async call<T>(action: string, scope: AiScope, payload: Record<string, unknown> = {}): Promise<T> {
    const token = this.config.get<string>('INTERNAL_SERVICE_TOKEN');
    if (!token) throw new ServiceUnavailableException('Chưa cấu hình kết nối nội bộ AI.');
    let response: Response;
    try {
      response = await fetch(
        `${this.config.get<string>('AI_SERVICE_URL') ?? 'http://localhost:3008'}/api/v1/internal/workspace-ai/${action}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-service-token': token },
          body: JSON.stringify({ ...payload, ...scope }),
          signal: AbortSignal.timeout(200000),
        },
      );
    } catch {
      throw new ServiceUnavailableException('AI Service chưa chạy hoặc kết nối quá thời gian.');
    }
    const result = (await response.json()) as {
      data: T;
      message?: string | string[];
      error?: { message?: string };
    };
    if (!response.ok) {
      const message = typeof result.message === 'string' ? result.message : result.error?.message;
      throw new HttpException(message ?? 'AI chưa xử lý được yêu cầu.', response.status);
    }
    return result.data;
  }
}

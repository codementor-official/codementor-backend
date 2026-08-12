import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  AlreadyExists,
  BusinessRuleViolation,
  DomainError,
  InvalidInput,
  NotAuthorized,
  NotFound,
} from '@codementor/kernel';

/** Ánh xạ mã lỗi domain → HTTP status. Domain không biết gì về HTTP; việc dịch nằm ở đây. */
const DOMAIN_STATUS: Record<string, HttpStatus> = {
  [new InvalidInput('').code]: HttpStatus.BAD_REQUEST,
  [new NotFound('').code]: HttpStatus.NOT_FOUND,
  [new AlreadyExists('').code]: HttpStatus.CONFLICT,
  [new NotAuthorized('').code]: HttpStatus.FORBIDDEN,
  [new BusinessRuleViolation('').code]: HttpStatus.UNPROCESSABLE_ENTITY,
};

export interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  path: string;
  timestamp: string;
  requestId?: string;
}

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const { status, body } = this.toErrorBody(exception, request);

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    void reply.status(status).send(body);
  }

  private toErrorBody(
    exception: unknown,
    request: FastifyRequest,
  ): { status: number; body: ErrorBody } {
    const base = {
      path: request.url,
      timestamp: new Date().toISOString(),
      requestId: request.id,
    };

    if (exception instanceof DomainError) {
      const status = DOMAIN_STATUS[exception.code] ?? HttpStatus.UNPROCESSABLE_ENTITY;
      return {
        status,
        body: {
          ...base,
          statusCode: status,
          code: exception.code,
          message: exception.message,
          details: exception.details,
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const message =
        typeof res === 'string' ? res : ((res as { message?: string | string[] }).message ?? exception.message);
      return {
        status,
        body: {
          ...base,
          statusCode: status,
          code: 'HTTP_ERROR',
          message: Array.isArray(message) ? message.join('; ') : message,
          details: typeof res === 'object' ? (res as Record<string, unknown>) : undefined,
        },
      };
    }

    // Không rò rỉ chi tiết nội bộ ra client.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        ...base,
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_ERROR',
        message: 'Đã xảy ra lỗi không mong muốn',
      },
    };
  }
}

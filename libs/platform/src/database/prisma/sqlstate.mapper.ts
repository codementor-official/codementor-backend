import {
  AlreadyExists,
  BusinessRuleViolation,
  DomainError,
  InvalidInput,
} from '@codementor/kernel';

/**
 * Database của CodeMentor cưỡng chế nhiều quy tắc nghiệp vụ bằng CHECK và trigger
 * (docs/02-dependency-model.md của infra). Khi vi phạm, Postgres trả về SQLSTATE thô —
 * hàm này dịch sang lỗi domain có nghĩa, thay vì để lộ lỗi driver ra API.
 *
 * Không nhân bản quy tắc ở tầng ứng dụng: CSDL vẫn là nơi cưỡng chế duy nhất.
 */
const SQLSTATE = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  RESTRICT_VIOLATION: '23001',
  NOT_NULL_VIOLATION: '23502',
} as const;

/** Trigger chống chu trình raise EXCEPTION với ERRCODE check_violation kèm thông điệp này. */
const CIRCULAR_HINT = 'circular dependency';

export class CircularDependencyError extends DomainError {
  readonly code = 'CIRCULAR_DEPENDENCY';
  constructor(detail: string) {
    super('Quan hệ phụ thuộc này sẽ tạo thành vòng lặp', { detail });
  }
}

interface PgError {
  code?: string;
  meta?: { code?: string; message?: string; constraint?: string; modelName?: string };
  message?: string;
}

export function mapDatabaseError(error: unknown): DomainError | undefined {
  const e = error as PgError;
  // Prisma bọc lỗi Postgres: P2010/P2002/... với sqlstate gốc trong meta.
  const sqlstate = e?.meta?.code ?? e?.code;
  const message = e?.meta?.message ?? e?.message ?? '';
  const constraint = e?.meta?.constraint;

  switch (sqlstate) {
    case SQLSTATE.CHECK_VIOLATION:
      if (message.includes(CIRCULAR_HINT)) return new CircularDependencyError(message);
      return new BusinessRuleViolation('Dữ liệu vi phạm ràng buộc nghiệp vụ', {
        constraint,
        sqlstate,
      });

    case SQLSTATE.UNIQUE_VIOLATION:
      return new AlreadyExists(e?.meta?.modelName ?? 'Bản ghi', { constraint });

    case SQLSTATE.FOREIGN_KEY_VIOLATION:
      return new InvalidInput('Tham chiếu tới bản ghi không tồn tại', { constraint });

    case SQLSTATE.RESTRICT_VIOLATION:
      return new BusinessRuleViolation('Không thể xoá vì đang được bản ghi khác tham chiếu', {
        constraint,
      });

    case SQLSTATE.NOT_NULL_VIOLATION:
      return new InvalidInput('Thiếu trường bắt buộc', { constraint });

    default:
      return undefined; // để filter xử lý như lỗi hệ thống
  }
}

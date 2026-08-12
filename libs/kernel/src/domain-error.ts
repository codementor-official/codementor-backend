/**
 * Lỗi nghiệp vụ. `code` là định danh ổn định để tầng HTTP ánh xạ sang status,
 * còn `message` dành cho người đọc — không bao giờ dịch ngược từ message.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  protected constructor(
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Vi phạm bất biến/quy tắc nghiệp vụ. → HTTP 422 */
export class BusinessRuleViolation extends DomainError {
  readonly code = 'BUSINESS_RULE_VIOLATION';
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}

/** Dữ liệu đầu vào sai ở tầng domain (khác validation HTTP). → HTTP 400 */
export class InvalidInput extends DomainError {
  readonly code = 'INVALID_INPUT';
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}

/** Không tìm thấy aggregate. → HTTP 404 */
export class NotFound extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(resource: string, id?: string) {
    super(`Không tìm thấy ${resource}${id ? ` với id ${id}` : ''}`, { resource, id });
  }
}

/** Đã tồn tại (vi phạm ràng buộc duy nhất). → HTTP 409 */
export class AlreadyExists extends DomainError {
  readonly code = 'ALREADY_EXISTS';
  constructor(resource: string, details?: Record<string, unknown>) {
    super(`${resource} đã tồn tại`, details);
  }
}

/** Đủ xác thực nhưng không đủ quyền cho hành động này. → HTTP 403 */
export class NotAuthorized extends DomainError {
  readonly code = 'NOT_AUTHORIZED';
  constructor(action: string, details?: Record<string, unknown>) {
    super(`Không có quyền thực hiện: ${action}`, details);
  }
}

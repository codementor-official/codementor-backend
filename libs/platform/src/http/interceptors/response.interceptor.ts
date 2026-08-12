import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';

export interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

/**
 * Bọc mọi response thành `{ data, meta }` để client có một hình dạng duy nhất.
 * Nếu handler đã trả đúng shape (ví dụ có phân trang) thì giữ nguyên.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(_ctx: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((payload) => {
        if (payload && typeof payload === 'object' && 'data' in payload) {
          return payload as unknown as ApiResponse<T>;
        }
        return { data: payload };
      }),
    );
  }
}

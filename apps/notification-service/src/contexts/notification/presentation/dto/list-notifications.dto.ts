import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator';

/** Dùng chung cho list, unread-count và read-all — ba đường đọc phải lọc CÙNG một điều kiện. */
export class NotificationScopeDto {
  /**
   * Giới hạn theo `NotificationType`, phẩy cách nhau (`?types=CONTENT_REVIEW_REQUESTED,ADMIN_ANNOUNCEMENT`).
   *
   * Không kiểm khớp với enum ở đây: bộ lọc này chỉ THU HẸP thêm những gì audience filter
   * đã cho phép, không bao giờ mở rộng nó — một giá trị lạ chỉ khớp 0 dòng, không lộ gì.
   * Ứng dụng lecturer/admin tự khai types cố định trong lib/api.ts của mình, ứng dụng học
   * viên bỏ trống để thấy mọi loại quảng bá.
   */
  @ApiPropertyOptional({ description: 'Lọc theo loại, phẩy cách nhau' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : value,
  )
  @IsArray()
  @IsString({ each: true })
  types?: string[];
}

export class ListNotificationsQueryDto extends NotificationScopeDto {
  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  /**
   * Con trỏ phân trang: `createdAt` của mục cuối trang trước. Dùng mốc thời gian thay cho
   * `offset` vì danh sách này được chèn thêm ở đầu liên tục — với `offset`, mỗi thông báo
   * mới sẽ đẩy một mục cũ lặp lại sang trang sau.
   */
  @ApiPropertyOptional({ description: 'createdAt của mục cuối trang trước (ISO-8601)' })
  @IsOptional()
  @IsISO8601()
  before?: string;
}

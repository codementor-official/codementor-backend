import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';

export class ListNotificationsQueryDto {
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

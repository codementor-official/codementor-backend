import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAnnouncementDto {
  @ApiProperty({ example: 'Bảo trì hệ thống' })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  title!: string;

  @ApiProperty({ example: 'CodeMentor sẽ bảo trì từ 22:00 đến 23:00 hôm nay.' })
  @IsString()
  @MinLength(1)
  // Đây là nội dung hiện trong một panel thông báo, không phải một bài viết.
  @MaxLength(1000)
  message!: string;
}

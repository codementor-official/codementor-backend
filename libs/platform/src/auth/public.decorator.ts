import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Đánh dấu endpoint không cần đăng nhập (đăng ký, đăng nhập, xem nội dung công khai). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

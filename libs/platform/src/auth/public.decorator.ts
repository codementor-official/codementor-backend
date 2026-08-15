import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Đánh dấu endpoint cho phép Guest truy cập mà không có access token. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

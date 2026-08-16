import { SetMetadata } from '@nestjs/common';
import type { PlatformRole } from './jwt-payload';

export const ROLES_KEY = 'codementor:roles';

/**
 * Giới hạn endpoint theo vai trò nền tảng.
 *
 * Trước đây backend chỉ kiểm "token có hợp lệ không" — nghĩa là một học viên gọi
 * đúng URL soạn bài là ghi được nội dung giảng dạy. Vai trò lấy từ realm role của
 * Keycloak, đã phân giải sẵn ở `KeycloakStrategy`.
 *
 * Đây KHÔNG thay cho kiểm quyền sở hữu: `@Roles('lecturer')` chỉ nói "được vào cửa",
 * còn "có phải bài của anh không" thì từng use case tự kiểm.
 */
export const Roles = (...roles: PlatformRole[]) => SetMetadata(ROLES_KEY, roles);

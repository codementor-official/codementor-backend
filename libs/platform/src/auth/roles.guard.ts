import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import type { AuthenticatedUser, PlatformRole } from './jwt-payload';

/**
 * Chạy SAU `KeycloakAuthGuard`, nên `request.user` đã có. Thứ tự này do Nest quyết
 * định theo thứ tự đăng ký APP_GUARD trong AuthModule — đảo lại thì guard này đọc
 * phải `undefined` và cho qua tất.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PlatformRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Không khai báo @Roles = không giới hạn thêm. Endpoint công khai đã được
    // KeycloakAuthGuard cho qua từ trước bằng @Public().
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user) return false;

    // admin đi được mọi cửa mà không phải liệt kê ở từng endpoint.
    if (user.role === 'admin' || required.includes(user.role)) return true;

    throw new ForbiddenException(
      `Cần vai trò ${required.join(' hoặc ')}; tài khoản đang ở vai trò ${user.role}`,
    );
  }
}

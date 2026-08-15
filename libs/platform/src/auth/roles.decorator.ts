import { SetMetadata } from '@nestjs/common';
import type { UserRole } from './user-role';

export const REQUIRED_ROLES_KEY = 'requiredRoles';

export const Roles = (...roles: UserRole[]) => SetMetadata(REQUIRED_ROLES_KEY, roles);

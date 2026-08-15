import type { PlatformRole, User } from '../domain/model/user';

/**
 * Hồ sơ dạng phẳng trả ra ngoài. Không để aggregate rò rỉ qua tầng presentation —
 * đổi cấu trúc nội bộ của `User` không được kéo theo đổi hợp đồng HTTP.
 */
export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  handle: string | null;
  role: PlatformRole;
  bio: string | null;
  avatarUrl: string | null;
  websiteUrl: string | null;
  githubHandle: string | null;
  locale: string;
  timezone: string;
  emailVerified: boolean;
}

export function toUserProfile(user: User): UserProfile {
  return {
    id: user.id,
    email: user.email.value,
    displayName: user.displayName,
    handle: user.handle?.value ?? null,
    role: user.role,
    bio: user.bio,
    avatarUrl: user.avatarUrl,
    websiteUrl: user.websiteUrl,
    githubHandle: user.githubHandle,
    locale: user.locale,
    timezone: user.timezone,
    emailVerified: user.isEmailVerified,
  };
}

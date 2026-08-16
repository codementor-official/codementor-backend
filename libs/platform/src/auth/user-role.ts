export enum UserRole {
  STUDENT = 'STUDENT',
  LECTURER = 'LECTURER',
  ADMIN = 'ADMIN',
  AI_AGENT = 'AI_AGENT',
}

export const HUMAN_ROLES = [UserRole.STUDENT, UserRole.LECTURER, UserRole.ADMIN] as const;

export function keycloakRoles(roles: readonly string[] | undefined): UserRole[] {
  const knownRoles = new Set<string>(Object.values(UserRole));
  return (roles ?? []).filter((role): role is UserRole => knownRoles.has(role));
}

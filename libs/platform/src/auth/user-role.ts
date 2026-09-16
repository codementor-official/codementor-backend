export enum UserRole {
  STUDENT = 'STUDENT',
  LECTURER = 'LECTURER',
  ADMIN = 'ADMIN',
  AI_AGENT = 'AI_AGENT',
}

export const HUMAN_ROLES = [UserRole.STUDENT, UserRole.LECTURER, UserRole.ADMIN] as const;

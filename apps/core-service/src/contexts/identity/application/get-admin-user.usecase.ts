import { Injectable } from '@nestjs/common';
import { NotFound } from '@codementor/kernel';
import { PrismaService } from '@codementor/platform';

/** Bộ đếm dẫn xuất từ bài nộp. Vắng mặt khi người này chưa giải bài nào. */
export interface AdminUserStats {
  xp: number;
  solvedCount: number;
  currentStreakDays: number;
  longestStreakDays: number;
  lastSolvedOn: string | null;
}

/** Khảo sát định hướng, người dùng làm một lần lúc mới vào. */
export interface AdminUserPreferences {
  learningGoal: string | null;
  careerGoal: string | null;
  currentLevel: string | null;
  weeklyStudyHours: number | null;
  interestedFields: string[];
  completedAt: string | null;
}

export interface AdminUserDetail {
  id: string;
  externalId: string | null;
  email: string;
  handle: string | null;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  websiteUrl: string | null;
  githubHandle: string | null;
  role: string;
  status: string;
  locale: string;
  timezone: string;
  emailVerifiedAt: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  updatedAt: string;
  stats: AdminUserStats | null;
  preferences: AdminUserPreferences | null;
}

/** `Date` từ Prisma; JSON hoá ngay ở đây để tầng trên không phải nhớ làm. */
function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/**
 * Hồ sơ đầy đủ của một tài khoản, cho drawer chi tiết bên quản trị.
 *
 * Ba bảng ĐỀU thuộc core-service (`users`, `user_stats`, `learning_preferences` — xem
 * app.module.ts), nên đọc thẳng là đúng phạm vi sở hữu. Hoạt động học tập, nhật ký kiểm
 * toán và lịch sử đăng nhập nằm ở nơi khác và có đường riêng — cố nhét vào đây sẽ biến
 * một truy vấn hồ sơ thành một lời gọi phụ thuộc bốn hệ thống, và hỏng cả bốn khi một cái
 * chậm.
 *
 * Tài khoản `status = 'deleted'` VẪN đọc được ở đây, khác với danh sách: quản trị viên
 * cần tra lại một tài khoản đã ngừng khi đối chiếu nội dung mà nó từng tạo ra.
 */
@Injectable()
export class GetAdminUserUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(userId: string): Promise<AdminUserDetail> {
    const [user] = await this.prisma.$queryRaw<
      {
        id: string;
        externalId: string | null;
        email: string;
        handle: string | null;
        displayName: string;
        bio: string | null;
        avatarUrl: string | null;
        websiteUrl: string | null;
        githubHandle: string | null;
        role: string;
        status: string;
        locale: string;
        timezone: string;
        emailVerifiedAt: Date | null;
        lastActiveAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
      }[]
    >`
      SELECT id, external_id AS "externalId", email::text AS email, handle::text AS handle,
             display_name AS "displayName", bio, avatar_url AS "avatarUrl",
             website_url AS "websiteUrl", github_handle AS "githubHandle",
             role::text AS role, status::text AS status, locale, timezone,
             email_verified_at AS "emailVerifiedAt", last_active_at AS "lastActiveAt",
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM users WHERE id = ${userId}::uuid`;

    if (user === undefined) throw new NotFound('Tài khoản', userId);

    const [stats] = await this.prisma.$queryRaw<
      {
        xp: number;
        solvedCount: number;
        currentStreakDays: number;
        longestStreakDays: number;
        lastSolvedOn: Date | null;
      }[]
    >`
      SELECT xp, solved_count AS "solvedCount", current_streak_days AS "currentStreakDays",
             longest_streak_days AS "longestStreakDays", last_solved_on AS "lastSolvedOn"
      FROM user_stats WHERE user_id = ${userId}::uuid`;

    const [preferences] = await this.prisma.$queryRaw<
      {
        learningGoal: string | null;
        careerGoal: string | null;
        currentLevel: string | null;
        weeklyStudyHours: number | null;
        interestedFields: string[] | null;
        completedAt: Date | null;
      }[]
    >`
      SELECT learning_goal AS "learningGoal", career_goal AS "careerGoal",
             current_level::text AS "currentLevel", weekly_study_hours AS "weeklyStudyHours",
             interested_fields AS "interestedFields", completed_at AS "completedAt"
      FROM learning_preferences WHERE user_id = ${userId}::uuid`;

    return {
      ...user,
      emailVerifiedAt: iso(user.emailVerifiedAt),
      lastActiveAt: iso(user.lastActiveAt),
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      stats:
        stats === undefined
          ? null
          : { ...stats, lastSolvedOn: iso(stats.lastSolvedOn)?.slice(0, 10) ?? null },
      preferences:
        preferences === undefined
          ? null
          : {
              ...preferences,
              interestedFields: preferences.interestedFields ?? [],
              completedAt: iso(preferences.completedAt),
            },
    };
  }
}

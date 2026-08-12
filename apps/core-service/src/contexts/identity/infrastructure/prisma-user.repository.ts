import { Injectable } from '@nestjs/common';
import { PrismaService } from '@codementor/platform';
import { mapDatabaseError } from '@codementor/platform';
import { Email } from '../domain/model/email';
import { Handle } from '../domain/model/handle';
import { User, type AccountStatus, type PlatformRole } from '../domain/model/user';
import type { UserRepository } from '../domain/port/user.repository';

interface UserRow {
  id: string;
  external_id: string;
  email: string;
  handle: string | null;
  display_name: string;
  role: string;
  status: string;
  email_verified_at: Date | null;
}

const COLUMNS = `id, external_id, email, handle, display_name, role, status, email_verified_at`;

/** Chỉ context Identity được đọc/ghi bảng `users`. Context khác đi qua identity.public.ts. */
@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    const rows = await this.prisma.$queryRawUnsafe<UserRow[]>(
      `SELECT ${COLUMNS} FROM users WHERE id = $1::uuid LIMIT 1`,
      id,
    );
    return rows[0] ? this.toDomain(rows[0]) : null;
  }

  async findByExternalId(externalId: string): Promise<User | null> {
    const rows = await this.prisma.$queryRawUnsafe<UserRow[]>(
      `SELECT ${COLUMNS} FROM users WHERE external_id = $1 LIMIT 1`,
      externalId,
    );
    return rows[0] ? this.toDomain(rows[0]) : null;
  }

  async findByEmail(email: Email): Promise<User | null> {
    const rows = await this.prisma.$queryRawUnsafe<UserRow[]>(
      `SELECT ${COLUMNS} FROM users WHERE email = $1::citext LIMIT 1`,
      email.value,
    );
    return rows[0] ? this.toDomain(rows[0]) : null;
  }

  async save(user: User): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO users (id, external_id, email, handle, display_name, role, status, email_verified_at)
         VALUES ($1::uuid, $2, $3::citext, $4::citext, $5, $6::platform_role, $7::account_status, $8)
         ON CONFLICT (external_id) DO UPDATE SET
           email             = EXCLUDED.email,
           handle            = EXCLUDED.handle,
           display_name      = EXCLUDED.display_name,
           role              = EXCLUDED.role,
           status            = EXCLUDED.status,
           email_verified_at = EXCLUDED.email_verified_at`,
        user.id,
        user.externalId,
        user.email.value,
        user.handle?.value ?? null,
        user.displayName,
        user.role,
        user.status,
        user.isEmailVerified ? new Date() : null,
      );
    } catch (error) {
      throw mapDatabaseError(error) ?? error;
    }
  }

  private toDomain(row: UserRow): User {
    const email = Email.create(row.email);
    if (email.isFail) {
      throw new Error(`Email không hợp lệ trong CSDL cho user ${row.id}`);
    }
    const handle = row.handle ? Handle.create(row.handle) : null;

    return User.rehydrate(row.id, {
      externalId: row.external_id,
      email: email.value,
      displayName: row.display_name,
      handle: handle?.isOk ? handle.value : null,
      role: row.role as PlatformRole,
      status: row.status as AccountStatus,
      emailVerifiedAt: row.email_verified_at,
    });
  }
}

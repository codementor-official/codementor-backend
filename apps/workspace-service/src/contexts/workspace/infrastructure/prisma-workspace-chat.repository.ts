import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@codementor/platform';
import type {
  WorkspaceChatRepository,
  WorkspaceMessageCursor,
  WorkspaceMessageRecord,
} from '../domain/port/workspace-chat.repository';

@Injectable()
export class PrismaWorkspaceChatRepository implements WorkspaceChatRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listMessages(groupId: string, cursor: WorkspaceMessageCursor | undefined, limit: number) {
    const cursorSql = cursor
      ? Prisma.sql`AND (m.created_at < ${cursor.createdAt} OR (m.created_at = ${cursor.createdAt} AND m.id < ${cursor.id}::uuid))`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<MessageRow[]>(Prisma.sql`
      SELECT m.id, m.group_id AS "groupId", m.sender_id AS "senderId", m.content,
             m.created_at AS "createdAt", m.updated_at AS "updatedAt", m.deleted_at AS "deletedAt",
             u.display_name AS "displayName", u.avatar_url AS "avatarUrl"
      FROM workspace_messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.group_id = ${groupId}::uuid ${cursorSql}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ${limit}
    `);
    return rows.map(mapMessage);
  }

  async findMessage(messageId: string) {
    const rows = await this.prisma.$queryRaw<MessageRow[]>(Prisma.sql`
      SELECT m.id, m.group_id AS "groupId", m.sender_id AS "senderId", m.content,
             m.created_at AS "createdAt", m.updated_at AS "updatedAt", m.deleted_at AS "deletedAt",
             u.display_name AS "displayName", u.avatar_url AS "avatarUrl"
      FROM workspace_messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.id = ${messageId}::uuid
      LIMIT 1
    `);
    return rows[0] ? mapMessage(rows[0]) : null;
  }

  async createMessage(groupId: string, senderId: string, content: string) {
    const [created] = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      INSERT INTO workspace_messages (group_id, sender_id, content)
      VALUES (${groupId}::uuid, ${senderId}::uuid, ${content})
      RETURNING id
    `);
    return (await this.findMessage(created.id))!;
  }

  async updateMessage(messageId: string, content: string) {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE workspace_messages SET content = ${content}, updated_at = NOW()
      WHERE id = ${messageId}::uuid
    `);
    return (await this.findMessage(messageId))!;
  }

  async deleteMessage(messageId: string) {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE workspace_messages SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = ${messageId}::uuid
    `);
    return (await this.findMessage(messageId))!;
  }

  async unreadCount(groupId: string, membershipId: string, userId: string) {
    const [row] = await this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM workspace_messages m
      LEFT JOIN workspace_message_reads r ON r.group_member_id = ${membershipId}::uuid
      WHERE m.group_id = ${groupId}::uuid
        AND m.sender_id <> ${userId}::uuid
        AND m.deleted_at IS NULL
        AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
    `);
    return Number(row?.count ?? 0n);
  }

  async markRead(membershipId: string, readAt: Date) {
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO workspace_message_reads (group_member_id, last_read_at, updated_at)
      VALUES (${membershipId}::uuid, ${readAt}, ${readAt})
      ON CONFLICT (group_member_id)
      DO UPDATE SET last_read_at = EXCLUDED.last_read_at, updated_at = EXCLUDED.updated_at
    `);
  }
}

interface MessageRow {
  id: string;
  groupId: string;
  senderId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  displayName: string;
  avatarUrl: string | null;
}

function mapMessage(row: MessageRow): WorkspaceMessageRecord {
  return {
    id: row.id,
    groupId: row.groupId,
    senderId: row.senderId,
    content: row.content,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    sender: { displayName: row.displayName, avatarUrl: row.avatarUrl },
  };
}

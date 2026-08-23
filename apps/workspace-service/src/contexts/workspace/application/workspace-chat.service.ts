import { Inject, Injectable } from '@nestjs/common';
import { BusinessRuleViolation, NotAuthorized, NotFound } from '@codementor/kernel';
import {
  WORKSPACE_CHAT_REPOSITORY,
  type WorkspaceChatRepository,
  type WorkspaceMessageCursor,
  type WorkspaceMessageRecord,
} from '../domain/port/workspace-chat.repository';
import type {
  CreateWorkspaceMessageDto,
  ListWorkspaceMessagesQueryDto,
  UpdateWorkspaceMessageDto,
} from '../presentation/dto/workspace.dto';
import { WorkspaceService } from './workspace.service';

const DEFAULT_LIMIT = 30;

@Injectable()
export class WorkspaceChatService {
  constructor(
    private readonly workspaces: WorkspaceService,
    @Inject(WORKSPACE_CHAT_REPOSITORY) private readonly chat: WorkspaceChatRepository,
  ) {}

  async history(userId: string, slug: string, query: ListWorkspaceMessagesQueryDto) {
    const workspace = await this.workspaces.detail(userId, slug);
    const limit = clamp(query.limit, DEFAULT_LIMIT, 50);
    const rows = await this.chat.listMessages(
      workspace.id,
      query.before ? decodeCursor(query.before) : undefined,
      limit + 1,
    );
    const page = rows.slice(0, limit);
    const oldest = page.at(-1);
    return {
      items: page.map(toMessage),
      nextCursor: rows.length > limit && oldest ? encodeCursor(oldest.createdAt, oldest.id) : null,
    };
  }

  async create(userId: string, slug: string, dto: CreateWorkspaceMessageDto) {
    const workspace = await this.workspaces.detail(userId, slug);
    const content = normaliseContent(dto.content);
    return toMessage(await this.chat.createMessage(workspace.id, userId, content));
  }

  async update(userId: string, slug: string, messageId: string, dto: UpdateWorkspaceMessageDto) {
    const workspace = await this.workspaces.detail(userId, slug);
    const message = await this.requireMessage(workspace.id, messageId);
    if (message.senderId !== userId)
      throw new NotAuthorized('Bạn chỉ có thể sửa tin nhắn của mình');
    if (message.deletedAt) throw new BusinessRuleViolation('Tin nhắn đã bị xóa');
    return toMessage(await this.chat.updateMessage(messageId, normaliseContent(dto.content)));
  }

  async remove(userId: string, slug: string, messageId: string) {
    const workspace = await this.workspaces.detail(userId, slug);
    const message = await this.requireMessage(workspace.id, messageId);
    const role = workspace.currentMembership.role;
    if (message.senderId !== userId && role !== 'owner' && role !== 'deputy') {
      throw new NotAuthorized('Bạn không có quyền kiểm duyệt tin nhắn này');
    }
    if (message.deletedAt) return toMessage(message);
    return toMessage(await this.chat.deleteMessage(messageId));
  }

  async unread(userId: string, slug: string) {
    const workspace = await this.workspaces.detail(userId, slug);
    return {
      count: await this.chat.unreadCount(workspace.id, workspace.currentMembership.id, userId),
    };
  }

  async markRead(userId: string, slug: string) {
    const workspace = await this.workspaces.detail(userId, slug);
    const readAt = new Date();
    await this.chat.markRead(workspace.currentMembership.id, readAt);
    return { readAt };
  }

  private async requireMessage(workspaceId: string, messageId: string) {
    const message = await this.chat.findMessage(messageId);
    if (!message || message.groupId !== workspaceId) throw new NotFound('Không tìm thấy tin nhắn');
    return message;
  }
}

function normaliseContent(value: string) {
  const content = value.trim();
  if (!content) throw new BusinessRuleViolation('Tin nhắn không được để trống');
  return content;
}

function toMessage(row: WorkspaceMessageRecord) {
  return {
    id: row.id,
    workspaceId: row.groupId,
    senderId: row.senderId,
    sender: row.sender,
    content: row.deletedAt ? null : row.content,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

function encodeCursor(createdAt: Date, id: string) {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString(
    'base64url',
  );
}

function decodeCursor(value: string): WorkspaceMessageCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      createdAt?: string;
      id?: string;
    };
    const createdAt = new Date(parsed.createdAt ?? '');
    if (!parsed.id || Number.isNaN(createdAt.getTime())) throw new Error('invalid');
    return { createdAt, id: parsed.id };
  } catch {
    throw new BusinessRuleViolation('Cursor lịch sử chat không hợp lệ');
  }
}

function clamp(value: number | undefined, fallback: number, maximum: number) {
  return Math.min(Math.max(value ?? fallback, 1), maximum);
}

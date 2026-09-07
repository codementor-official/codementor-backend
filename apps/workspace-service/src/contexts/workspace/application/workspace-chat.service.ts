import { Inject, Injectable } from '@nestjs/common';
import { BusinessRuleViolation, NotAuthorized, NotFound } from '@codementor/kernel';
import { TOPICS } from '@codementor/contracts';
import { EVENT_BUS, type EventBus } from '@codementor/messaging';
import { DOCUMENT_CONTENT_TYPES, ObjectStorageService } from '@codementor/platform';
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
  DocumentUploadUrlDto,
} from '../presentation/dto/workspace.dto';
import { WorkspaceService } from './workspace.service';
import { isWorkspaceAttachmentMessage } from './workspace-chat-content';

const DEFAULT_LIMIT = 30;

@Injectable()
export class WorkspaceChatService {
  constructor(
    private readonly workspaces: WorkspaceService,
    @Inject(WORKSPACE_CHAT_REPOSITORY) private readonly chat: WorkspaceChatRepository,
    @Inject(EVENT_BUS) private readonly events: EventBus,
    private readonly storage: ObjectStorageService,
  ) {}

  async attachmentUpload(userId: string, slug: string, dto: DocumentUploadUrlDto) {
    const workspace = await this.workspaces.detail(userId, slug);
    if (!DOCUMENT_CONTENT_TYPES.includes(dto.contentType as (typeof DOCUMENT_CONTENT_TYPES)[number]))
      throw new BusinessRuleViolation('Định dạng tệp không được hỗ trợ');
    const result = await this.storage.presignDocumentUpload({
      prefix: `workspaces/${workspace.id}/chat`,
      filename: dto.filename,
      contentType: dto.contentType,
      sizeBytes: dto.sizeBytes,
    });
    if (result.isFail) throw result.error;
    return { ...result.value, maxBytes: this.storage.maxDocumentUploadBytes };
  }

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

  async resources(userId: string, slug: string) {
    const workspace = await this.workspaces.detail(userId, slug);
    const rows = await this.chat.listMessages(workspace.id, undefined, 500);
    const seen = new Set<string>();
    const items = rows.flatMap((row) => {
      if (row.deletedAt) return [];
      const urls = row.content.match(/https?:\/\/[^\s<>()]+/g) ?? [];
      return urls.flatMap((raw) => {
        const url = raw.replace(/[.,;!?]+$/, '');
        if (seen.has(url)) return [];
        seen.add(url);
        const pathname = (() => { try { return new URL(url).pathname; } catch { return ''; } })();
        const filename = decodeURIComponent(pathname.split('/').pop() || url);
        const kind = /\.(pdf|docx?|pptx?|xlsx?|txt|md|csv|zip|png|jpe?g|webp)$/i.test(pathname) ? 'file' : 'link';
        return [{ url, title: filename || url, kind, senderName: row.sender.displayName, createdAt: row.createdAt }];
      });
    });
    return { items, total: items.length, scannedMessages: rows.length };
  }

  async create(userId: string, slug: string, dto: CreateWorkspaceMessageDto) {
    const workspace = await this.workspaces.detail(userId, slug);
    const content = normaliseContent(dto.content);
    const message = await this.chat.createMessage(workspace.id, userId, content);
    const recipientExternalIds = await this.chat.notificationRecipients(workspace.id, userId);
    if (recipientExternalIds.length > 0) {
      await this.events.publish(
        TOPICS.WORKSPACE_MESSAGE_CREATED,
        {
          groupId: workspace.id,
          workspaceSlug: workspace.slug,
          workspaceName: workspace.name,
          messageId: message.id,
          senderName: message.sender.displayName,
          contentPreview: content.length > 160 ? `${content.slice(0, 157)}…` : content,
          recipientExternalIds,
        },
        { actorUserId: userId },
      );
    }
    return toMessage(message);
  }

  async update(userId: string, slug: string, messageId: string, dto: UpdateWorkspaceMessageDto) {
    const workspace = await this.workspaces.detail(userId, slug);
    const message = await this.requireMessage(workspace.id, messageId);
    if (message.senderId !== userId)
      throw new NotAuthorized('Bạn chỉ có thể sửa tin nhắn của mình');
    if (message.deletedAt) throw new BusinessRuleViolation('Tin nhắn đã bị xóa');
    if (isWorkspaceAttachmentMessage(message.content))
      throw new BusinessRuleViolation('Tin nhắn có tệp hoặc hình ảnh không thể chỉnh sửa');
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

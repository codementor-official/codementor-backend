export interface WorkspaceMessageCursor {
  createdAt: Date;
  id: string;
}

export interface WorkspaceMessageRecord {
  id: string;
  groupId: string;
  senderId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  sender: {
    displayName: string;
    avatarUrl: string | null;
  };
}

export interface WorkspaceChatRepository {
  listMessages(
    groupId: string,
    cursor: WorkspaceMessageCursor | undefined,
    limit: number,
  ): Promise<WorkspaceMessageRecord[]>;
  findMessage(messageId: string): Promise<WorkspaceMessageRecord | null>;
  createMessage(
    groupId: string,
    senderId: string,
    content: string,
  ): Promise<WorkspaceMessageRecord>;
  updateMessage(messageId: string, content: string): Promise<WorkspaceMessageRecord>;
  deleteMessage(messageId: string): Promise<WorkspaceMessageRecord>;
  unreadCount(groupId: string, membershipId: string, userId: string): Promise<number>;
  markRead(membershipId: string, readAt: Date): Promise<void>;
}

export const WORKSPACE_CHAT_REPOSITORY = Symbol('WORKSPACE_CHAT_REPOSITORY');

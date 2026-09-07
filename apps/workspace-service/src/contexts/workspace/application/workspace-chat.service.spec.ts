import { isWorkspaceAttachmentMessage } from './workspace-chat-content';

describe('WorkspaceChatService attachment editing guard', () => {
  it('recognises uploaded files and images', () => {
    expect(isWorkspaceAttachmentMessage('🖼️ avatar.png\nhttps://cdn.example/avatar.png')).toBe(true);
    expect(isWorkspaceAttachmentMessage('📎 bai-tap.pdf\nhttps://cdn.example/bai-tap.pdf')).toBe(true);
  });

  it('keeps ordinary text and shared links editable', () => {
    expect(isWorkspaceAttachmentMessage('Hẹn học lúc 20:00')).toBe(false);
    expect(isWorkspaceAttachmentMessage('Xem tài liệu https://example.com/tai-lieu')).toBe(false);
  });
});

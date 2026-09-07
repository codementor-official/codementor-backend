export function isWorkspaceAttachmentMessage(content: string) {
  return /^(?:🖼️|📎)\s+[^\r\n]+\r?\nhttps?:\/\/\S+$/u.test(content.trim());
}

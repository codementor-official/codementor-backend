export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
export interface SendEmailInput {
  recipient: string;
  subject: string;
  html: string;
  text: string;
}
export interface EmailSendResult {
  messageId: string;
}
export interface EmailProvider {
  send(input: SendEmailInput): Promise<EmailSendResult>;
}
export class EmailDeliveryError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly ambiguous = false,
  ) {
    super(code);
  }
}

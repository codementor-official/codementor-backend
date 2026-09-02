import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import {
  EmailDeliveryError,
  type EmailProvider,
  type SendEmailInput,
} from '../domain/port/email-provider';

@Injectable()
export class SesEmailProvider implements EmailProvider, OnModuleDestroy {
  private readonly client: SESv2Client;
  constructor(private readonly config: ConfigService) {
    // Same AWS_REGION + default credential chain as ObjectStorageService.
    // A transport-level retry can send the same email twice, so the durable queue owns retries.
    this.client = new SESv2Client({
      region: config.get<string>('AWS_REGION'),
      maxAttempts: 1,
      requestHandler: { connectionTimeout: 5000, requestTimeout: 15000 },
    });
  }
  async send(input: SendEmailInput) {
    if (!this.config.get<boolean>('SES_ENABLED'))
      throw new EmailDeliveryError('SES_DISABLED', false);
    try {
      const result = await this.client.send(
        new SendEmailCommand({
          FromEmailAddress: `"${this.config.get<string>('SES_FROM_NAME')}" <${this.config.get<string>('SES_FROM_EMAIL')}>`,
          Destination: { ToAddresses: [input.recipient] },
          Content: {
            Simple: {
              Subject: { Data: input.subject, Charset: 'UTF-8' },
              Body: {
                Html: { Data: input.html, Charset: 'UTF-8' },
                Text: { Data: input.text, Charset: 'UTF-8' },
              },
            },
          },
        }),
      );
      if (!result.MessageId) throw new EmailDeliveryError('MISSING_MESSAGE_ID', false, true);
      return { messageId: result.MessageId };
    } catch (error) {
      if (error instanceof EmailDeliveryError) throw error;
      const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      const code = e.name ?? 'SES_UNKNOWN';
      // Explicit throttling/service rejection may be retried. A timeout/5xx after
      // acceptance is ambiguous because SES SendEmail has no idempotency token.
      const retryable = [
        'TooManyRequestsException',
        'LimitExceededException',
        'ThrottlingException',
      ].includes(code);
      const ambiguous = !e.$metadata?.httpStatusCode || e.$metadata.httpStatusCode >= 500;
      throw new EmailDeliveryError(code, retryable, ambiguous);
    }
  }
  onModuleDestroy() {
    this.client.destroy();
  }
}

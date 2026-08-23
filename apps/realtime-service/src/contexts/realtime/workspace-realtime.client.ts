import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WorkspaceRealtimeClient {
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.baseUrl = config
      .get<string>('WORKSPACE_SERVICE_URL', 'http://localhost:3004')
      .replace(/\/$/, '');
  }

  detail(token: string, slug: string) {
    return this.request(token, `/api/v1/workspaces/${encodeURIComponent(slug)}`);
  }

  createMessage(token: string, slug: string, content: string) {
    return this.request(token, `/api/v1/workspaces/${encodeURIComponent(slug)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  }

  updateMessage(token: string, slug: string, messageId: string, content: string) {
    return this.request(
      token,
      `/api/v1/workspaces/${encodeURIComponent(slug)}/messages/${encodeURIComponent(messageId)}`,
      { method: 'PATCH', body: JSON.stringify({ content }) },
    );
  }

  deleteMessage(token: string, slug: string, messageId: string) {
    return this.request(
      token,
      `/api/v1/workspaces/${encodeURIComponent(slug)}/messages/${encodeURIComponent(messageId)}`,
      { method: 'DELETE' },
    );
  }

  markRead(token: string, slug: string) {
    return this.request(token, `/api/v1/workspaces/${encodeURIComponent(slug)}/messages/read`, {
      method: 'POST',
    });
  }

  private async request(token: string, path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
    });
    const payload = (await response.json().catch(() => null)) as {
      message?: string | string[];
      data?: unknown;
    } | null;
    if (!response.ok) {
      const message = Array.isArray(payload?.message)
        ? payload.message.join(', ')
        : payload?.message || 'Workspace service không phản hồi';
      throw new Error(message);
    }
    return payload && 'data' in payload ? payload.data : payload;
  }
}

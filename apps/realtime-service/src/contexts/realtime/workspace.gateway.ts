import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { HandshakeAuthService, type SocketIdentity } from './handshake-auth.service';
import { WorkspaceRealtimeClient } from './workspace-realtime.client';

interface WorkspaceSocketData {
  accessToken?: string;
  identity?: SocketIdentity;
  workspaces?: Set<string>;
}

@WebSocketGateway({ namespace: '/realtime', cors: { origin: true, credentials: true } })
export class WorkspaceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(WorkspaceGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly handshake: HandshakeAuthService,
    private readonly workspace: WorkspaceRealtimeClient,
  ) {}

  async handleConnection(socket: Socket) {
    await this.ensureIdentity(socket);
  }

  handleDisconnect(socket: Socket) {
    const data = socket.data as WorkspaceSocketData;
    if (data.identity)
      this.logger.debug(`workspace socket disconnected: ${data.identity.externalId}`);
  }

  @SubscribeMessage('workspace:join')
  async join(@ConnectedSocket() socket: Socket, @MessageBody() body: { slug?: string }) {
    return this.guard(socket, async (token, data) => {
      const slug = workspaceSlug(body.slug);
      await this.workspace.detail(token, slug);
      await socket.join(room(slug));
      data.workspaces?.add(slug);
      return { ok: true, slug };
    });
  }

  @SubscribeMessage('workspace:leave')
  async leave(@ConnectedSocket() socket: Socket, @MessageBody() body: { slug?: string }) {
    return this.guard(socket, async (_token, data) => {
      const slug = workspaceSlug(body.slug);
      await socket.leave(room(slug));
      data.workspaces?.delete(slug);
      return { ok: true, slug };
    });
  }

  @SubscribeMessage('message:send')
  async send(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { slug?: string; content?: string },
  ) {
    return this.guard(socket, async (token, data) => {
      const slug = requireJoined(data, body.slug);
      const message = await this.workspace.createMessage(token, slug, body.content ?? '');
      this.server.to(room(slug)).emit('message:new', { slug, message });
      return { ok: true, message };
    });
  }

  @SubscribeMessage('message:update')
  async update(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { slug?: string; messageId?: string; content?: string },
  ) {
    return this.guard(socket, async (token, data) => {
      const slug = requireJoined(data, body.slug);
      const messageId = required(body.messageId, 'Thiếu messageId');
      const message = await this.workspace.updateMessage(
        token,
        slug,
        messageId,
        body.content ?? '',
      );
      this.server.to(room(slug)).emit('message:update', { slug, message });
      return { ok: true, message };
    });
  }

  @SubscribeMessage('message:delete')
  async remove(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { slug?: string; messageId?: string },
  ) {
    return this.guard(socket, async (token, data) => {
      const slug = requireJoined(data, body.slug);
      const messageId = required(body.messageId, 'Thiếu messageId');
      const message = await this.workspace.deleteMessage(token, slug, messageId);
      this.server.to(room(slug)).emit('message:delete', { slug, message });
      return { ok: true, message };
    });
  }

  @SubscribeMessage('message:read')
  async read(@ConnectedSocket() socket: Socket, @MessageBody() body: { slug?: string }) {
    return this.guard(socket, async (token, data) => {
      const slug = requireJoined(data, body.slug);
      const result = (await this.workspace.markRead(token, slug)) as { readAt: string };
      this.server.to(room(slug)).emit('message:read', {
        slug,
        externalId: data.identity?.externalId,
        readAt: result.readAt,
      });
      return { ok: true, ...result };
    });
  }

  private async guard<T>(
    socket: Socket,
    action: (token: string, data: WorkspaceSocketData) => Promise<T>,
  ): Promise<T | { ok: false; error: string }> {
    const data = await this.ensureIdentity(socket);
    if (!data?.accessToken || !data.identity) return { ok: false, error: 'Phiên không hợp lệ' };
    try {
      return await action(data.accessToken, data);
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  /** A client can emit immediately after `connect`; initialise lazily to avoid racing the async handshake hook. */
  private async ensureIdentity(socket: Socket): Promise<WorkspaceSocketData | null> {
    const data = socket.data as WorkspaceSocketData;
    if (data.accessToken && data.identity && data.workspaces) return data;
    const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
    const identity = await this.handshake.verify(token);
    if (!token || !identity) return null;
    data.accessToken = token;
    data.identity = identity;
    data.workspaces ??= new Set<string>();
    return data;
  }
}

function room(slug: string) {
  return `workspace:${slug}`;
}

function workspaceSlug(value: string | undefined) {
  const slug = required(value, 'Thiếu Workspace slug').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,119}$/.test(slug)) throw new Error('Workspace slug không hợp lệ');
  return slug;
}

function requireJoined(data: WorkspaceSocketData, value: string | undefined) {
  const slug = workspaceSlug(value);
  if (!data.workspaces?.has(slug)) throw new Error('Bạn chưa tham gia phòng chat này');
  return slug;
}

function required(value: string | undefined, message: string) {
  if (!value) throw new Error(message);
  return value;
}

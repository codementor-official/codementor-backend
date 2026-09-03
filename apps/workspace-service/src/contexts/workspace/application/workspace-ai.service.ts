import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  AiConversation,
  AiDocumentSource,
  AiIndexStatus,
  AiScope,
  AiStatus,
  AiTurn,
} from '@codementor/contracts';
import { WorkspaceService } from './workspace.service';
import { WorkspaceAiClient } from '../infrastructure/workspace-ai.client';
import {
  WORKSPACE_CONTENT_REPOSITORY,
  type WorkspaceContentRepository,
  type WorkspaceDocumentRecord,
} from '../domain/port/workspace-content.repository';

@Injectable()
export class WorkspaceAiService {
  constructor(
    private readonly workspaces: WorkspaceService,
    @Inject(WORKSPACE_CONTENT_REPOSITORY) private readonly content: WorkspaceContentRepository,
    private readonly ai: WorkspaceAiClient,
  ) {}
  private async scope(userId: string, slug: string): Promise<AiScope> {
    const detail = await this.workspaces.detail(userId, slug);
    if (detail.currentMembership.role !== 'owner' && !detail.currentMembership.permissions.view_doc)
      throw new ForbiddenException('Bạn không có quyền đọc tài liệu trong nhóm này.');
    return { userId, workspaceId: detail.id };
  }
  private descriptor(doc: WorkspaceDocumentRecord): AiDocumentSource {
    const source = {
      id: doc.id,
      title: doc.title,
      docType: doc.docType.toLowerCase(),
      storageKey: doc.storageKey,
      previewText: doc.storageKey ? null : doc.previewText,
    };
    return {
      ...source,
      revision: createHash('sha256')
        .update(JSON.stringify({ ...source, uploadedAt: doc.uploadedAt.toISOString() }))
        .digest('hex'),
    };
  }
  private async sources(scope: AiScope, ids: string[]) {
    if (!ids.length || ids.length > 8 || new Set(ids).size !== ids.length)
      throw new BadRequestException('Chọn từ 1 đến 8 tài liệu khác nhau.');
    return Promise.all(
      ids.map(async (id) => {
        const doc = await this.content.findDocument(scope.workspaceId, id);
        // Deliberately no owner/moderator bypass: unapproved or removed documents are never AI evidence.
        if (!doc || doc.deletedAt || doc.status !== 'published')
          throw new NotFoundException('Tài liệu không tồn tại hoặc chưa được duyệt.');
        return this.descriptor(doc);
      }),
    );
  }
  async status(userId: string, slug: string) {
    return this.ai.call<AiStatus>('status', await this.scope(userId, slug));
  }
  async documents(
    userId: string,
    slug: string,
    query: { page: number; limit: number; q?: string },
  ) {
    const scope = await this.scope(userId, slug);
    const capabilities = await this.ai.call<AiStatus>('status', scope);
    const page = await this.content.listDocuments(scope.workspaceId, {
      ...query,
      publishedOnly: true,
      types: capabilities.supportedTypes,
    });
    const states = await this.ai.call<AiIndexStatus[]>('documents', scope, {
      sources: page.items.map((doc) => this.descriptor(doc)),
    });
    return {
      ...page,
      items: page.items.map((doc) => ({
        title: doc.title,
        docType: doc.docType.toLowerCase(),
        ...(states.find((state) => state.id === doc.id) ?? {
          id: doc.id,
          state: 'not_indexed',
          chunkCount: 0,
        }),
      })),
    };
  }
  async index(userId: string, slug: string, id: string) {
    const scope = await this.scope(userId, slug);
    return this.ai.call<AiIndexStatus>('index', scope, {
      sources: await this.sources(scope, [id]),
    });
  }
  async documentStates(userId: string, slug: string, ids: string[], prepare = false) {
    const scope = await this.scope(userId, slug);
    // Resolve ALL sources before starting any job. The browser only supplies IDs.
    const sources = await this.sources(scope, ids);
    if (prepare) {
      for (const source of sources)
        await this.ai.call('index', scope, { sources: [source] });
    }
    return this.ai.call<AiIndexStatus[]>('documents', scope, { sources });
  }
  async create(userId: string, slug: string, documentIds: string[]) {
    const scope = await this.scope(userId, slug);
    return this.ai.call<AiConversation>('create', scope, {
      sources: await this.sources(scope, documentIds),
    });
  }
  async list(userId: string, slug: string, query: { page: number; limit: number }) {
    return this.ai.call('list', await this.scope(userId, slug), query);
  }
  async remove(userId: string, slug: string, id: string) {
    return this.ai.call('delete', await this.scope(userId, slug), { id });
  }
  async read(userId: string, slug: string, id: string) {
    const scope = await this.scope(userId, slug);
    const meta = await this.ai.call<{ documentIds: string[] }>('metadata', scope, { id });
    return this.ai.call<AiConversation>('read', scope, {
      id,
      sources: await this.sources(scope, meta.documentIds),
    });
  }
  async ask(userId: string, slug: string, id: string, question: string, requestId: string) {
    const scope = await this.scope(userId, slug);
    const meta = await this.ai.call<{ documentIds: string[] }>('metadata', scope, { id });
    const sources = await this.sources(scope, meta.documentIds);
    const turn = await this.ai.call<AiTurn>('ask', scope, { id, question, requestId, sources });
    // Revalidate after the long provider call: permission or moderation may change while waiting.
    const currentScope = await this.scope(userId, slug);
    const currentSources = await this.sources(currentScope, meta.documentIds);
    if (
      sources.some(
        (source) =>
          !currentSources.some(
            (current) => current.id === source.id && current.revision === source.revision,
          ),
      )
    )
      throw new ForbiddenException('Nguồn tài liệu đã thay đổi khi AI đang trả lời.');
    return turn;
  }
}

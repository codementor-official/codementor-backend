import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { WorkspaceAiService } from './workspace-ai.service';
import type { WorkspaceService } from './workspace.service';
import type { WorkspaceContentRepository } from '../domain/port/workspace-content.repository';
import type { WorkspaceAiClient } from '../infrastructure/workspace-ai.client';

// Unit-test the authorization facade, not WorkspaceService's Kafka/Keycloak dependencies.
jest.mock('./workspace.service', () => ({ WorkspaceService: class {} }));

describe('Workspace AI authorization', () => {
  const detail = jest.fn();
  const findDocument = jest.fn();
  const listDocuments = jest.fn();
  const call = jest.fn();
  let service: WorkspaceAiService;
  const doc = {
    id: 'document', title: 'Stack', docType: 'TXT', storageKey: null, previewText: 'LIFO',
    status: 'published', deletedAt: null, uploadedAt: new Date('2026-01-01'),
  };
  beforeEach(() => {
    jest.resetAllMocks();
    service = new WorkspaceAiService(
      { detail } as unknown as WorkspaceService,
      { findDocument, listDocuments } as unknown as WorkspaceContentRepository,
      { call } as unknown as WorkspaceAiClient,
    );
    detail.mockResolvedValue({ id: 'workspace', currentMembership: { role: 'member', permissions: { view_doc: true } } });
    findDocument.mockResolvedValue(doc);
    call.mockImplementation(async (action: string) => action === 'metadata' ? { documentIds: ['document'] } : {});
  });
  it('derives scope from authenticated user and workspace lookup', async () => {
    await service.create('authenticated-user', 'slug', ['document']);
    expect(detail).toHaveBeenCalledWith('authenticated-user', 'slug');
    expect(call).toHaveBeenCalledWith('create', { userId: 'authenticated-user', workspaceId: 'workspace' }, expect.objectContaining({ sources: expect.any(Array) }));
    expect(findDocument).toHaveBeenCalledWith('workspace', 'document');
  });
  it('rejects outsiders before AI sees source data', async () => {
    detail.mockRejectedValue(new NotFoundException());
    await expect(service.create('outsider', 'slug', ['document'])).rejects.toBeInstanceOf(NotFoundException);
    expect(call).not.toHaveBeenCalled();
  });
  it('enforces denied view_doc even for deputy', async () => {
    detail.mockResolvedValue({ id: 'workspace', currentMembership: { role: 'deputy', permissions: { view_doc: false } } });
    await expect(service.status('deputy', 'slug')).rejects.toBeInstanceOf(ForbiddenException);
    expect(call).not.toHaveBeenCalled();
  });
  it.each(['pending', 'hidden', 'rejected'])('never indexes %s documents, including for owner', async (status) => {
    detail.mockResolvedValue({ id: 'workspace', currentMembership: { role: 'owner', permissions: {} } });
    findDocument.mockResolvedValue({ ...doc, status });
    await expect(service.index('owner', 'slug', 'document')).rejects.toBeInstanceOf(NotFoundException);
    expect(call).not.toHaveBeenCalled();
  });
  it('does not read removed documents', async () => {
    findDocument.mockResolvedValue({ ...doc, deletedAt: new Date() });
    await expect(service.create('member', 'slug', ['document'])).rejects.toBeInstanceOf(NotFoundException);
  });
  it('forces approved-only pagination and hides storage metadata from client', async () => {
    listDocuments.mockResolvedValue({ items: [doc], page: 2, limit: 10, total: 15, totalPages: 2 });
    call.mockImplementation(async (action: string) => action === 'status'
      ? { supportedTypes: ['pdf', 'docx', 'pptx', 'txt', 'md'] }
      : [{ id: 'document', state: 'ready', chunkCount: 1 }]);
    const page = await service.documents('member', 'slug', { page: 2, limit: 10, q: 'Stack' });
    expect(listDocuments).toHaveBeenCalledWith('workspace', { page: 2, limit: 10, q: 'Stack', publishedOnly: true, types: ['pdf', 'docx', 'pptx', 'txt', 'md'] });
    expect(page.items[0]).not.toHaveProperty('previewText');
    expect(page.items[0]).not.toHaveProperty('storageKey');
  });
  it('automatically prepares only the selected approved sources', async () => {
    await service.documentStates('member', 'slug', ['document'], true);
    expect(call).toHaveBeenCalledWith('index', { userId: 'member', workspaceId: 'workspace' }, { sources: [expect.objectContaining({ id: 'document' })] });
    expect(call).toHaveBeenCalledWith('documents', expect.anything(), { sources: expect.any(Array) });
  });
  it('status polling never starts or retries jobs', async () => {
    await service.documentStates('member', 'slug', ['document']);
    expect(call.mock.calls.map(([action]) => action)).toEqual(['documents']);
  });
  it('checks every source before preparing any document', async () => {
    findDocument.mockResolvedValueOnce(doc).mockResolvedValueOnce({ ...doc, status: 'pending' });
    await expect(service.documentStates('member', 'slug', ['document', 'pending'], true)).rejects.toBeInstanceOf(NotFoundException);
    expect(call).not.toHaveBeenCalled();
  });
  it('rechecks permission after model response', async () => {
    detail.mockResolvedValueOnce({ id: 'workspace', currentMembership: { role: 'member', permissions: { view_doc: true } } });
    detail.mockResolvedValueOnce({ id: 'workspace', currentMembership: { role: 'member', permissions: { view_doc: false } } });
    await expect(service.ask('member', 'slug', 'conversation', 'Stack?', 'request')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rechecks publication after model response', async () => {
    findDocument.mockResolvedValueOnce(doc).mockResolvedValueOnce({ ...doc, status: 'hidden' });
    await expect(service.ask('member', 'slug', 'conversation', 'Stack?', 'request')).rejects.toBeInstanceOf(NotFoundException);
  });
});

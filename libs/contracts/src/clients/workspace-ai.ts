/** Internal workspace -> AI contract. Document descriptors are never accepted from browsers. */
export interface AiDocumentSource {
  id: string;
  title: string;
  docType: string;
  storageKey: string | null;
  previewText: string | null;
  revision: string;
}
export interface AiScope {
  userId: string;
  workspaceId: string;
}
export interface AiIndexStatus {
  id: string;
  state: 'not_indexed' | 'queued' | 'processing' | 'ready' | 'failed' | 'unsupported';
  chunkCount: number;
  error?: string;
}
export interface AiStatus {
  configured: boolean;
  embeddingModel: string;
  chatModel: string;
  supportedTypes: string[];
  maxDocuments: number;
}

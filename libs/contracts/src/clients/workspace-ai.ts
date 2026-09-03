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
export interface AiCitation {
  sourceId: string;
  documentId: string;
  title: string;
  page: number | null;
  excerpt: string;
}
export interface AiTurn {
  id: string;
  question: string;
  answer: string;
  supplementalAnswer?: string;
  citations: AiCitation[];
  insufficientEvidence: boolean;
  createdAt: string;
}
export interface AiConversation {
  id: string;
  title: string;
  documentIds: string[];
  documents: { id: string; title: string }[];
  turns: AiTurn[];
  createdAt: string;
  updatedAt: string;
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

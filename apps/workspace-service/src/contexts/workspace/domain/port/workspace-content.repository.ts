export interface ContentPage<T> { items: T[]; page: number; limit: number; total: number; totalPages: number }
export interface WorkspaceDocumentRecord { id: string; title: string; docType: string; topic: string | null; uploaderId: string | null; uploaderName: string | null; sizeBytes: number | null; storageKey: string | null; url: string | null; previewText: string | null; status: string; aiVerdict: string; uploadedAt: Date }
export interface WorkspaceExerciseRecord { id: string; exerciseId: string; slug: string; title: string; summary: string | null; difficulty: string; status: string; source: string; xp: number; dueAt: Date | null; attemptLimit: number | null; allowRetry: boolean; allowLateSubmission: boolean; phase: string | null; assignedCount: number; completedCount: number }
export interface WorkspaceAssignmentRecord { id: string; groupExerciseId: string; exerciseId: string; exerciseSlug: string; exerciseTitle: string; memberId: string; memberName: string; status: string; reviewStatus: string; feedback: string | null; startedAt: Date | null; updatedAt: Date; submissionCount: number; latestVerdict: string | null; latestScore: number | null; latestAttemptNumber: number | null; latestIsLate: boolean; latestSubmittedAt: Date | null }

export interface WorkspaceContentRepository {
  listDocuments(groupId: string, input: { page: number; limit: number; q?: string; status?: string; type?: string; publishedOnly: boolean }): Promise<ContentPage<WorkspaceDocumentRecord>>;
  createDocument(groupId: string, input: { title: string; docType: string; topic?: string; uploaderId: string; sizeBytes: number; storageKey: string; url: string }): Promise<WorkspaceDocumentRecord>;
  updateDocument(groupId: string, id: string, input: { title?: string; topic?: string | null; status?: string }): Promise<WorkspaceDocumentRecord | null>;
  deleteDocument(groupId: string, id: string): Promise<WorkspaceDocumentRecord | null>;
  listExercises(groupId: string, input: { page: number; limit: number; q?: string; status?: string; difficulty?: string; publishedOnly: boolean }): Promise<ContentPage<WorkspaceExerciseRecord>>;
  publicExerciseExists(exerciseId: string): Promise<boolean>;
  attachExercise(groupId: string, userId: string, input: { exerciseId: string; dueAt?: Date; attemptLimit?: number; allowRetry: boolean; allowLateSubmission: boolean; memberIds: string[] }): Promise<void>;
  updateExercise(groupId: string, id: string, input: { dueAt?: Date | null; attemptLimit?: number | null; allowRetry?: boolean; allowLateSubmission?: boolean; memberIds?: string[] }): Promise<boolean>;
  exerciseHasSubmissions(groupId: string, id: string): Promise<boolean>;
  deleteExercise(groupId: string, id: string): Promise<boolean>;
  listAssignments(groupId: string, input: { page: number; limit: number; q?: string; status?: string; memberId?: string }): Promise<ContentPage<WorkspaceAssignmentRecord>>;
  updateAssignment(groupId: string, id: string, input: { status?: string; reviewStatus?: string; feedback?: string | null; reviewedBy?: string; memberId?: string }): Promise<boolean>;
}

export const WORKSPACE_CONTENT_REPOSITORY = Symbol('WORKSPACE_CONTENT_REPOSITORY');

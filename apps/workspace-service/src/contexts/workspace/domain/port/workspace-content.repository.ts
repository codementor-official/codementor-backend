export interface ContentPage<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
export interface WorkspaceDocumentRecord {
  id: string;
  title: string;
  docType: string;
  topic: string | null;
  uploaderId: string | null;
  uploaderName: string | null;
  sizeBytes: number | null;
  storageKey: string | null;
  url: string | null;
  previewText: string | null;
  status: string;
  aiVerdict: string;
  uploadedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
  deleteReason: string | null;
}
export interface WorkspaceExerciseRecord {
  id: string;
  exerciseId: string;
  slug: string;
  title: string;
  summary: string | null;
  difficulty: string;
  status: string;
  source: string;
  authorId: string | null;
  publicationStatus: string;
  deletedAt: Date | null;
  deletedBy: string | null;
  deleteReason: string | null;
  xp: number;
  estimatedMinutes: number | null;
  timeLimitMs: number;
  memoryLimitKb: number;
  dueAt: Date | null;
  attemptLimit: number | null;
  allowRetry: boolean;
  allowLateSubmission: boolean;
  phase: string | null;
  assignedCount: number;
  completedCount: number;
  isAssignedToMe: boolean;
  myAssignment: {
    id: string;
    status: string;
    submissionCount: number;
    latestVerdict: string | null;
  } | null;
}
export interface WorkspaceAssignmentRecord {
  id: string;
  groupExerciseId: string;
  exerciseId: string;
  exerciseSlug: string;
  exerciseTitle: string;
  dueAt: Date | null;
  memberId: string;
  memberName: string;
  status: string;
  reviewStatus: string;
  feedback: string | null;
  startedAt: Date | null;
  updatedAt: Date;
  submissionCount: number;
  latestVerdict: string | null;
  latestScore: number | null;
  latestAttemptNumber: number | null;
  latestIsLate: boolean;
  latestSubmittedAt: Date | null;
}

export interface AssignmentSubmissionContext {
  assignmentId: string;
  exerciseId: string;
  dueAt: Date | null;
  attemptLimit: number | null;
  allowRetry: boolean;
  allowLateSubmission: boolean;
  submissionCount: number;
}
export interface WorkspaceSubmissionRecord {
  id: string;
  userId: string;
  language: string;
  sourceCode: string;
  verdict: string;
  score: number | null;
  passedTests: number | null;
  totalTests: number | null;
  runtimeMs: number | null;
  memoryKb: number | null;
  attemptNumber: number;
  isLate: boolean;
  note: string | null;
  runDetailRef: string | null;
  submittedAt: Date;
}
export interface WorkspaceExerciseDetailRecord extends WorkspaceExerciseRecord {
  assignmentMemberIds: string[];
}

export interface WorkspaceContentRepository {
  listDocuments(
    groupId: string,
    input: {
      page: number;
      limit: number;
      q?: string;
      status?: string;
      type?: string;
      publishedOnly: boolean;
      removedOnly?: boolean;
    },
  ): Promise<ContentPage<WorkspaceDocumentRecord>>;
  findDocument(groupId: string, id: string): Promise<WorkspaceDocumentRecord | null>;
  createDocument(
    groupId: string,
    input: {
      title: string;
      docType: string;
      topic?: string;
      uploaderId: string;
      sizeBytes: number;
      storageKey: string;
      url: string;
    },
  ): Promise<WorkspaceDocumentRecord>;
  updateDocument(
    groupId: string,
    id: string,
    input: { title?: string; topic?: string | null; status?: string },
  ): Promise<WorkspaceDocumentRecord | null>;
  pendingDocumentCount(groupId: string): Promise<number>;
  softDeleteDocument(
    groupId: string,
    id: string,
    userId: string,
    reason?: string,
  ): Promise<boolean>;
  restoreDocument(groupId: string, id: string): Promise<boolean>;
  purgeDocument(groupId: string, id: string): Promise<WorkspaceDocumentRecord | null>;
  reportDocument(
    groupId: string,
    documentId: string,
    reporterId: string,
    category: string,
    note?: string,
  ): Promise<{ id: string; status: string; createdAt: Date }>;
  approvedDocumentContext(
    groupId: string,
    documentIds?: string[],
  ): Promise<Array<{ id: string; title: string; previewText: string | null }>>;
  listExercises(
    groupId: string,
    input: {
      page: number;
      limit: number;
      q?: string;
      status?: string;
      difficulty?: string;
      scope?: string;
      memberId: string;
      publishedOnly: boolean;
      removedOnly?: boolean;
    },
  ): Promise<ContentPage<WorkspaceExerciseRecord>>;
  exerciseDetail(groupId: string, id: string): Promise<WorkspaceExerciseDetailRecord | null>;
  publicExerciseExists(exerciseId: string): Promise<boolean>;
  attachExercise(
    groupId: string,
    userId: string,
    input: {
      exerciseId: string;
      dueAt?: Date;
      attemptLimit?: number;
      allowRetry: boolean;
      allowLateSubmission: boolean;
      memberIds: string[];
    },
  ): Promise<{ groupExerciseId: string; exerciseTitle: string }>;
  assignmentNotificationRecipients(groupId: string, memberIds: string[]): Promise<string[]>;
  createExercise(
    groupId: string,
    userId: string,
    input: {
      title: string;
      slug?: string;
      summary?: string;
      difficulty: 'easy' | 'medium' | 'hard';
      source: 'manual' | 'ai';
      xpReward: number;
      estimatedMinutes?: number;
      timeLimitMs: number;
      memoryLimitKb: number;
      content: Record<string, unknown>;
      dueAt?: Date;
      attemptLimit?: number;
      allowRetry: boolean;
      allowLateSubmission: boolean;
      memberIds: string[];
    },
  ): Promise<WorkspaceExerciseRecord>;
  duplicateExercise(
    groupId: string,
    id: string,
    userId: string,
  ): Promise<WorkspaceExerciseRecord | null>;
  updateExercise(
    groupId: string,
    id: string,
    input: {
      dueAt?: Date | null;
      attemptLimit?: number | null;
      allowRetry?: boolean;
      allowLateSubmission?: boolean;
      memberIds?: string[];
      title?: string;
      summary?: string | null;
      difficulty?: 'easy' | 'medium' | 'hard';
      estimatedMinutes?: number | null;
      timeLimitMs?: number;
      memoryLimitKb?: number;
      publicationStatus?: 'published' | 'hidden';
      content?: Record<string, unknown>;
    },
  ): Promise<boolean>;
  exerciseHasSubmissions(groupId: string, id: string): Promise<boolean>;
  softDeleteExercise(
    groupId: string,
    id: string,
    userId: string,
    reason?: string,
  ): Promise<boolean>;
  restoreExercise(groupId: string, id: string): Promise<boolean>;
  purgeExercise(groupId: string, id: string): Promise<boolean>;
  listAssignments(
    groupId: string,
    input: {
      page: number;
      limit: number;
      q?: string;
      status?: string;
      memberId?: string;
      groupExerciseId?: string;
    },
  ): Promise<ContentPage<WorkspaceAssignmentRecord>>;
  assignmentExists(groupId: string, id: string, memberId?: string): Promise<boolean>;
  assignmentSubmissionContext(
    assignmentId: string,
    userId: string,
  ): Promise<AssignmentSubmissionContext | null>;
  submissionHistory(groupId: string, assignmentId: string): Promise<WorkspaceSubmissionRecord[]>;
  updateAssignment(
    groupId: string,
    id: string,
    input: {
      status?: string;
      reviewStatus?: string;
      feedback?: string | null;
      reviewedBy?: string;
      memberId?: string;
    },
  ): Promise<boolean>;
}

export const WORKSPACE_CONTENT_REPOSITORY = Symbol('WORKSPACE_CONTENT_REPOSITORY');

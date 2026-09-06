import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { AlreadyExists, BusinessRuleViolation, NotAuthorized, NotFound } from '@codementor/kernel';
import { DOCUMENT_CONTENT_TYPES, ObjectStorageService } from '@codementor/platform';
import { TOPICS } from '@codementor/contracts';
import { EVENT_BUS, type EventBus } from '@codementor/messaging';
import {
  WORKSPACE_CONTENT_REPOSITORY,
  type WorkspaceContentRepository,
} from '../domain/port/workspace-content.repository';
import { WorkspaceService } from './workspace.service';
import type {
  AttachWorkspaceExerciseDto,
  CreateWorkspaceExerciseDto,
  CreateWorkspaceDocumentDto,
  DocumentUploadUrlDto,
  GenerateWorkspaceExerciseDraftDto,
  RemoveWorkspaceContentDto,
  ReportWorkspaceDocumentDto,
  UpdateWorkspaceAssignmentDto,
  UpdateWorkspaceDocumentDto,
  UpdateWorkspaceExerciseDto,
  WorkspaceAssetUploadUrlDto,
  WorkspaceContentQueryDto,
} from '../presentation/dto/workspace.dto';

type Detail = Awaited<ReturnType<WorkspaceService['detail']>>;

@Injectable()
export class WorkspaceContentService {
  private readonly logger = new Logger(WorkspaceContentService.name);

  constructor(
    private readonly workspaces: WorkspaceService,
    @Inject(WORKSPACE_CONTENT_REPOSITORY) private readonly content: WorkspaceContentRepository,
    private readonly storage: ObjectStorageService,
    @InjectConnection() private readonly mongo: Connection,
    @Inject(EVENT_BUS) private readonly events: EventBus,
  ) {}

  /** Internal read used by submission-service; never accepts a user id from the browser body. */
  assignmentSubmissionContext(userId: string, assignmentId: string) {
    return this.content.assignmentSubmissionContext(assignmentId, userId);
  }

  async uploadConfig(userId: string, slug: string) {
    const detail = await this.workspaces.detail(userId, slug);
    this.require(detail, 'upload_doc');
    return {
      enabled: this.storage.isConfigured,
      maxBytes: this.storage.maxDocumentUploadBytes,
      acceptedTypes: DOCUMENT_CONTENT_TYPES,
    };
  }
  async presign(userId: string, slug: string, dto: DocumentUploadUrlDto) {
    const detail = await this.workspaces.detail(userId, slug);
    this.require(detail, 'upload_doc');
    const result = await this.storage.presignDocumentUpload({
      prefix: `workspaces/${detail.id}`,
      filename: dto.filename,
      contentType: dto.contentType,
      sizeBytes: dto.sizeBytes,
    });
    if (result.isFail) throw result.error;
    return result.value;
  }
  async presignAsset(userId: string, slug: string, dto: WorkspaceAssetUploadUrlDto) {
    const detail = await this.workspaces.detail(userId, slug);
    if (detail.currentMembership.role !== 'owner')
      throw new NotAuthorized('Chỉ Chủ nhóm được thay ảnh nhóm');
    const result = await this.storage.presignDocumentUpload({
      prefix: `workspaces/${detail.id}/branding/${dto.kind}`,
      filename: dto.filename,
      contentType: dto.contentType,
      sizeBytes: dto.sizeBytes,
    });
    if (result.isFail) throw result.error;
    return result.value;
  }
  async coverPreview(userId: string, slug: string) {
    let cover: { coverKey: string | null; coverUrl: string | null };
    try {
      const detail = await this.workspaces.detail(userId, slug);
      cover = { coverKey: detail.coverKey, coverUrl: detail.coverUrl };
    } catch (cause) {
      if (!(cause instanceof NotFound)) throw cause;
      cover = await this.workspaces.publicCoverSource(userId, slug);
    }
    if (!cover.coverKey) return { url: cover.coverUrl, expiresInSeconds: null };
    const result = await this.storage.presignDownload(cover.coverKey, 'workspace-cover', 'inline');
    if (result.isFail) throw result.error;
    return result.value;
  }
  async documents(userId: string, slug: string, query: WorkspaceContentQueryDto) {
    const detail = await this.workspaces.detail(userId, slug);
    this.requireAny(detail, ['view_doc']);
    const canEditAny = this.canAny(detail, ['edit_doc']);
    const canApprove = this.canAny(detail, ['approve_doc']);
    const canDeleteAny = this.canAny(detail, ['delete_doc']);
    const canViewUnpublished = canEditAny || canApprove || canDeleteAny;
    const removedOnly = query.status === 'removed';
    if (removedOnly && !canDeleteAny) throw new NotAuthorized('Bạn không có quyền xem thùng rác');
    const page = await this.content.listDocuments(detail.id, {
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      q: clean(query.search ?? query.q),
      status: clean(query.status),
      type: clean(query.type),
      publishedOnly: !canViewUnpublished,
      removedOnly,
    });
    return {
      ...page,
      items: page.items.map((document) => ({
        ...document,
        canEdit:
          canEditAny || (document.uploaderId === userId && this.canAny(detail, ['edit_own_doc'])),
        canDelete:
          canDeleteAny ||
          (document.uploaderId === userId && this.canAny(detail, ['delete_own_doc'])),
        canApprove,
        canViewUnpublished,
      })),
    };
  }
  async pendingDocumentCount(userId: string, slug: string) {
    const detail = await this.workspaces.detail(userId, slug);
    this.requireAny(detail, ['approve_doc']);
    return { count: await this.content.pendingDocumentCount(detail.id) };
  }
  async createDocument(userId: string, slug: string, dto: CreateWorkspaceDocumentDto) {
    const detail = await this.workspaces.detail(userId, slug);
    this.require(detail, 'upload_doc');
    const prefix = `workspaces/${detail.id}`;
    if (!this.storage.isDocumentKeyFor(dto.storageKey, prefix))
      throw new BusinessRuleViolation('Tệp không thuộc Workspace này');
    if (!(await this.storage.objectExists(dto.storageKey)))
      throw new BusinessRuleViolation('Tệp chưa tồn tại trên storage');
    const created = await this.content.createDocument(detail.id, {
      title: dto.title.trim(),
      docType: dto.docType.trim(),
      topic: clean(dto.topic),
      uploaderId: userId,
      sizeBytes: dto.sizeBytes,
      storageKey: dto.storageKey,
      url: dto.url,
    });
    return detail.currentMembership.role === 'owner'
      ? this.content.updateDocument(detail.id, created.id, { status: 'published', reviewedBy: userId })
      : created;
  }
  async updateDocument(userId: string, slug: string, id: string, dto: UpdateWorkspaceDocumentDto) {
    const detail = await this.workspaces.detail(userId, slug);
    const existing = await this.content.findDocument(detail.id, id);
    if (!existing || existing.deletedAt) throw new NotFound('Tài liệu', id);
    const canEditAny = this.canAny(detail, ['edit_doc']);
    const canEditOwn = existing.uploaderId === userId && this.canAny(detail, ['edit_own_doc']);
    const hasMetadataPatch = dto.title !== undefined || dto.topic !== undefined;
    const hasStatusPatch = dto.status !== undefined;
    if (hasMetadataPatch && !canEditAny && !canEditOwn)
      throw new NotAuthorized('Bạn không có quyền sửa tài liệu này');
    if (hasStatusPatch && !this.canAny(detail, ['approve_doc']))
      throw new NotAuthorized('Bạn không có quyền duyệt tài liệu');
    if (!hasMetadataPatch && !hasStatusPatch)
      throw new BusinessRuleViolation('Không có thay đổi hợp lệ');
    const updated = await this.content.updateDocument(detail.id, id, {
      title: dto.title?.trim(),
      topic: dto.topic === undefined ? undefined : (clean(dto.topic) ?? null),
      status: dto.status,
      reviewedBy: hasStatusPatch ? userId : undefined,
    });
    if (!updated) throw new NotFound('Tài liệu', id);
    return updated;
  }
  async deleteDocument(userId: string, slug: string, id: string, dto?: RemoveWorkspaceContentDto) {
    const detail = await this.workspaces.detail(userId, slug);
    const existing = await this.content.findDocument(detail.id, id);
    if (!existing || existing.deletedAt) throw new NotFound('Tài liệu', id);
    const allowed =
      this.canAny(detail, ['delete_doc']) ||
      (existing.uploaderId === userId && this.canAny(detail, ['delete_own_doc']));
    if (!allowed) throw new NotAuthorized('Bạn không có quyền xóa tài liệu này');
    if (!(await this.content.softDeleteDocument(detail.id, id, userId, clean(dto?.reason))))
      throw new NotFound('Tài liệu', id);
  }
  async restoreDocument(userId: string, slug: string, id: string) {
    const detail = await this.workspaces.detail(userId, slug);
    this.requireAny(detail, ['delete_doc']);
    if (!(await this.content.restoreDocument(detail.id, id))) throw new NotFound('Tài liệu', id);
    return { restored: true };
  }
  async purgeDocument(userId: string, slug: string, id: string) {
    const detail = await this.workspaces.detail(userId, slug);
    this.requireAny(detail, ['delete_doc']);
    const removed = await this.content.purgeDocument(detail.id, id);
    if (!removed) throw new NotFound('Tài liệu đã xóa', id);
    if (removed.storageKey) await this.storage.deleteObject(removed.storageKey);
  }
  async reportDocument(userId: string, slug: string, id: string, dto: ReportWorkspaceDocumentDto) {
    const detail = await this.workspaces.detail(userId, slug);
    this.requireAny(detail, ['view_doc']);
    const document = await this.content.findDocument(detail.id, id);
    if (!document || document.deletedAt || document.status !== 'published')
      throw new NotFound('Tài liệu', id);
    try {
      return await this.content.reportDocument(
        detail.id,
        id,
        userId,
        dto.category,
        clean(dto.note),
      );
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002')
        throw new AlreadyExists('Báo cáo tài liệu');
      throw error;
    }
  }
  async documentDownload(userId: string, slug: string, id: string, preview = false) {
    const detail = await this.workspaces.detail(userId, slug);
    this.requireAny(detail, ['view_doc']);
    const document = await this.content.findDocument(detail.id, id);
    if (!document) throw new NotFound('Tài liệu', id);
    const canViewUnpublished = this.canAny(detail, ['edit_doc', 'approve_doc', 'delete_doc']);
    if (document.deletedAt || (!canViewUnpublished && document.status !== 'published'))
      throw new NotFound('Tài liệu', id);
    if (!document.storageKey) return { url: document.url, expiresInSeconds: null };
    const result = await this.storage.presignDownload(
      document.storageKey,
      document.title,
      preview ? 'inline' : 'attachment',
    );
    if (result.isFail) throw result.error;
    return result.value;
  }

  async exercises(userId: string, slug: string, query: WorkspaceContentQueryDto) {
    const detail = await this.workspaces.detail(userId, slug);
    this.requireAny(detail, ['view_exercise']);
    const canDeleteAny = this.canAny(detail, ['delete_exercise']);
    const canEditAny = this.canAny(detail, ['edit_exercise']);
    if (query.status === 'removed' && !canDeleteAny)
      throw new NotAuthorized('Bạn không có quyền xem thùng rác');
    const page = await this.content.listExercises(detail.id, {
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      q: clean(query.search ?? query.q),
      status: clean(query.status),
      difficulty: clean(query.difficulty),
      scope: query.scope,
      memberId: detail.currentMembership.id,
      publishedOnly: !canEditAny,
      removedOnly: query.status === 'removed',
    });
    return {
      ...page,
      items: page.items.map((exercise) => ({
        ...exercise,
        canEdit:
          canEditAny ||
          (exercise.authorId === userId && this.canAny(detail, ['edit_own_exercise'])),
        canDelete:
          canDeleteAny ||
          (exercise.authorId === userId && this.canAny(detail, ['delete_own_exercise'])),
        canRestore: canDeleteAny,
      })),
    };
  }
  async exerciseDetail(userId: string, slug: string, id: string) {
    const detail = await this.workspaces.detail(userId, slug);
    const exercise = await this.content.exerciseDetail(detail.id, id);
    if (!exercise) throw new NotFound('Bài tập nhóm', id);
    const canDeleteAny = this.canAny(detail, ['delete_exercise']);
    const canEdit =
      this.canAny(detail, ['edit_exercise']) ||
      (exercise.authorId === userId && this.canAny(detail, ['edit_own_exercise']));
    const canAssign = this.canAny(detail, ['assign_exercise']);
    if (exercise.publicationStatus === 'hidden' && !canEdit) throw new NotFound('Bài tập nhóm', id);
    const canReview =
      detail.currentMembership.role === 'owner' ||
      detail.currentMembership.permissions.review_submission;
    const mine =
      (
        await this.content.listAssignments(detail.id, {
          page: 1,
          limit: 1,
          memberId: detail.currentMembership.id,
          groupExerciseId: id,
        })
      ).items[0] ?? null;
    const content = (await this.mongo
      .collection('exercise_contents')
      .findOne(
        { exerciseId: exercise.exerciseId },
        { projection: { _id: 0, exerciseId: 0, kind: 0, createdAt: 0, updatedAt: 0 } },
      )) as Record<string, unknown> | null;
    return {
      ...exercise,
      content: content ? (canEdit ? content : toLearnerExerciseContent(content)) : null,
      isAssignedToMe: Boolean(mine),
      myAssignment: mine
        ? {
            id: mine.id,
            status: mine.status,
            submissionCount: mine.submissionCount,
            latestVerdict: mine.latestVerdict,
          }
        : null,
      assignedMemberIds: canAssign ? exercise.assignmentMemberIds : [],
      canManage: canEdit,
      canEdit,
      canAssign,
      canPublish: canDeleteAny,
      canRestore: canDeleteAny,
      canReview,
    };
  }
  async exerciseForSolve(userId: string, slug: string, id: string) {
    const detail = await this.workspaces.detail(userId, slug);
    this.requireAny(detail, ['view_exercise']);
    const exercise = await this.content.exerciseDetail(detail.id, id);
    if (!exercise) throw new NotFound('Bài tập nhóm', id);

    const canEdit =
      this.canAny(detail, ['edit_exercise']) ||
      (exercise.authorId === userId && this.canAny(detail, ['edit_own_exercise']));
    if (exercise.publicationStatus === 'hidden' && !canEdit)
      throw new NotFound('Bài tập nhóm', id);

    const content = (await this.mongo
      .collection('exercise_contents')
      .findOne(
        { exerciseId: exercise.exerciseId },
        { projection: { _id: 0, exerciseId: 0, kind: 0, createdAt: 0, updatedAt: 0 } },
      )) as Record<string, unknown> | null;

    return {
      id: exercise.exerciseId,
      slug: exercise.slug,
      title: exercise.title,
      summary: exercise.summary,
      kind: 'code',
      difficulty: exercise.difficulty,
      status: exercise.status,
      visibility: 'group',
      authorId: exercise.authorId,
      authorName: null,
      forkedFromId: null,
      updatedAt: exercise.updatedAt.toISOString(),
      xpReward: exercise.xp,
      estimatedMinutes: exercise.estimatedMinutes,
      timeLimitMs: exercise.timeLimitMs,
      memoryLimitKb: exercise.memoryLimitKb,
      publishedAt: exercise.publishedAt?.toISOString() ?? null,
      content: content ? toLearnerExerciseContent(content) : null,
    };
  }
  async attachExercise(userId: string, slug: string, dto: AttachWorkspaceExerciseDto) {
    const detail = await this.workspaces.detail(userId, slug);
    this.requireAny(detail, ['assign_exercise']);
    if (!(await this.content.publicExerciseExists(dto.exerciseId)))
      throw new NotFound('Bài tập', dto.exerciseId);
    const linked = await this.content.attachExercise(detail.id, userId, {
      exerciseId: dto.exerciseId,
      dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
      attemptLimit: dto.attemptLimit,
      allowRetry: dto.allowRetry ?? true,
      allowLateSubmission: dto.allowLateSubmission ?? false,
      memberIds: dto.memberIds,
    });
    await this.publishAssignmentCreated(detail, {
      ...linked,
      exerciseId: dto.exerciseId,
      memberIds: dto.memberIds,
      dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
    });
    return { attached: true };
  }
  async createExercise(userId: string, slug: string, dto: CreateWorkspaceExerciseDto) {
    const detail = await this.workspaces.detail(userId, slug);
    this.requireAny(detail, ['create_exercise']);
    if (dto.memberIds.length && !this.canAny(detail, ['assign_exercise']))
      throw new NotAuthorized('Bạn không có quyền phân công bài tập');
    const created = await this.content.createExercise(detail.id, userId, {
      title: dto.title.trim(),
      slug: clean(dto.slug),
      summary: clean(dto.summary),
      difficulty: dto.difficulty,
      source: dto.source ?? 'manual',
      xpReward: dto.xpReward ?? 100,
      estimatedMinutes: dto.estimatedMinutes,
      timeLimitMs: dto.timeLimitMs ?? 1000,
      memoryLimitKb: dto.memoryLimitKb ?? 262144,
      content: dto.content,
      tagIds: dto.tagIds,
      dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
      attemptLimit: dto.attemptLimit,
      allowRetry: dto.allowRetry ?? true,
      allowLateSubmission: dto.allowLateSubmission ?? false,
      memberIds: dto.memberIds,
    });
    await this.publishAssignmentCreated(detail, {
      groupExerciseId: created.id,
      exerciseId: created.exerciseId,
      exerciseTitle: created.title,
      memberIds: dto.memberIds,
      dueAt: created.dueAt,
    });
    return created;
  }
  async generateExerciseDraft(
    userId: string,
    slug: string,
    dto: GenerateWorkspaceExerciseDraftDto,
  ) {
    const detail = await this.workspaces.detail(userId, slug);
    this.requireAny(detail, ['create_exercise']);
    const documents = await this.content.approvedDocumentContext(detail.id, dto.documentIds);
    if (!documents.length)
      throw new BusinessRuleViolation('Workspace chưa có tài liệu đã duyệt để tạo bản nháp');
    const context = documents
      .map(
        (item) => `- ${item.title}${item.previewText ? `: ${item.previewText.slice(0, 500)}` : ''}`,
      )
      .join('\n');
    return {
      title: dto.prompt.trim().slice(0, 200),
      summary: `Bản nháp được tạo từ ${documents.length} tài liệu đã duyệt trong Workspace.`,
      difficulty: dto.difficulty ?? 'medium',
      source: 'ai',
      sourceDocuments: documents.map(({ id, title }) => ({ id, title })),
      content: {
        statement: `${dto.prompt.trim()}\n\nNgữ cảnh tham khảo:\n${context}`,
        ioMode: 'stdin_stdout',
        constraints: ['Đọc kỹ dữ liệu đầu vào và xử lý đúng các trường hợp biên.'],
        examples: [
          {
            input: 'Dữ liệu mẫu',
            output: 'Kết quả mẫu',
            explanation: 'Chủ nhóm cần rà soát ví dụ trước khi lưu.',
          },
        ],
        testCases: [],
        languages: [],
        evaluation: { checker: 'trimmed', stopOnFirstFailure: false },
      },
    };
  }
  async duplicateExercise(userId: string, slug: string, id: string) {
    const detail = await this.workspaces.detail(userId, slug);
    this.requireAny(detail, ['create_exercise']);
    const created = await this.content.duplicateExercise(detail.id, id, userId);
    if (!created) throw new NotFound('Bài tập nhóm', id);
    return created;
  }
  async updateExercise(userId: string, slug: string, id: string, dto: UpdateWorkspaceExerciseDto) {
    const detail = await this.workspaces.detail(userId, slug);
    const existing = await this.content.exerciseDetail(detail.id, id);
    if (!existing) throw new NotFound('Bài tập nhóm', id);
    const canDeleteAny = this.canAny(detail, ['delete_exercise']);
    const canEdit =
      this.canAny(detail, ['edit_exercise']) ||
      (existing.authorId === userId && this.canAny(detail, ['edit_own_exercise']));
    const canAssign = this.canAny(detail, ['assign_exercise']);
    const hasAssignmentPatch =
      dto.memberIds !== undefined ||
      dto.dueAt !== undefined ||
      dto.attemptLimit !== undefined ||
      dto.allowRetry !== undefined ||
      dto.allowLateSubmission !== undefined;
    const hasContentPatch =
      dto.title !== undefined ||
      dto.summary !== undefined ||
      dto.difficulty !== undefined ||
      dto.estimatedMinutes !== undefined ||
      dto.timeLimitMs !== undefined ||
      dto.memoryLimitKb !== undefined ||
      dto.content !== undefined ||
      dto.tagIds !== undefined;
    if (hasContentPatch && !canEdit) throw new NotAuthorized('Bạn không có quyền sửa bài tập này');
    if (hasAssignmentPatch && !canAssign)
      throw new NotAuthorized('Bạn không có quyền phân công bài tập');
    if (dto.publicationStatus && !canDeleteAny)
      throw new NotAuthorized('Bạn không có quyền ẩn hoặc xuất bản bài tập');
    if (!hasContentPatch && !hasAssignmentPatch && dto.publicationStatus === undefined)
      throw new BusinessRuleViolation('Không có thay đổi hợp lệ');
    const newlyAssigned =
      dto.memberIds?.filter((memberId) => !existing.assignmentMemberIds.includes(memberId)) ?? [];
    const updated = await this.content.updateExercise(detail.id, id, {
      dueAt: dto.dueAt === undefined ? undefined : dto.dueAt ? new Date(dto.dueAt) : null,
      attemptLimit: dto.attemptLimit,
      allowRetry: dto.allowRetry,
      allowLateSubmission: dto.allowLateSubmission,
      memberIds: dto.memberIds,
      title: dto.title?.trim(),
      summary: dto.summary === undefined ? undefined : (clean(dto.summary) ?? null),
      difficulty: dto.difficulty,
      estimatedMinutes: dto.estimatedMinutes,
      timeLimitMs: dto.timeLimitMs,
      memoryLimitKb: dto.memoryLimitKb,
      publicationStatus: dto.publicationStatus,
      content: dto.content,
      tagIds: dto.tagIds,
    });
    if (!updated) throw new NotFound('Bài tập nhóm', id);
    if (newlyAssigned.length > 0) {
      await this.publishAssignmentCreated(detail, {
        groupExerciseId: existing.id,
        exerciseId: existing.exerciseId,
        exerciseTitle: dto.title?.trim() || existing.title,
        memberIds: newlyAssigned,
        dueAt: dto.dueAt === undefined ? existing.dueAt : dto.dueAt ? new Date(dto.dueAt) : null,
      });
    }
    return { updated: true };
  }
  async deleteExercise(userId: string, slug: string, id: string, dto?: RemoveWorkspaceContentDto) {
    const detail = await this.workspaces.detail(userId, slug);
    const existing = await this.content.exerciseDetail(detail.id, id);
    if (!existing) throw new NotFound('Bài tập nhóm', id);
    const allowed =
      this.canAny(detail, ['delete_exercise']) ||
      (existing.authorId === userId && this.canAny(detail, ['delete_own_exercise']));
    if (!allowed) throw new NotAuthorized('Bạn không có quyền xóa bài tập này');
    if (!(await this.content.softDeleteExercise(detail.id, id, userId, clean(dto?.reason))))
      throw new NotFound('Bài tập nhóm', id);
  }
  async restoreExercise(userId: string, slug: string, id: string) {
    const detail = await this.workspaces.detail(userId, slug);
    this.requireAny(detail, ['delete_exercise']);
    if (!(await this.content.restoreExercise(detail.id, id)))
      throw new NotFound('Bài tập nhóm', id);
    return { restored: true };
  }
  async purgeExercise(userId: string, slug: string, id: string) {
    const detail = await this.workspaces.detail(userId, slug);
    this.requireAny(detail, ['delete_exercise']);
    if (!(await this.content.purgeExercise(detail.id, id))) throw new NotFound('Bài tập nhóm', id);
  }

  myPendingAssignments(userId: string) {
    return this.content.myPendingAssignments(userId);
  }

  async assignments(userId: string, slug: string, query: WorkspaceContentQueryDto) {
    const detail = await this.workspaces.detail(userId, slug);
    const canReview =
      detail.currentMembership.role === 'owner' ||
      detail.currentMembership.permissions.review_submission;
    const canViewAssignments = canReview || this.canAny(detail, ['assign_exercise']);
    const page = await this.content.listAssignments(detail.id, {
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      q: clean(query.q),
      status: clean(query.status),
      memberId: canViewAssignments ? undefined : detail.currentMembership.id,
      groupExerciseId: query.groupExerciseId,
    });
    if (canReview || !canViewAssignments) return page;
    return {
      ...page,
      items: page.items.map((assignment) => ({
        ...assignment,
        submissionCount: 0,
        latestVerdict: null,
        latestScore: null,
        latestAttemptNumber: null,
        latestIsLate: false,
        latestSubmittedAt: null,
      })),
    };
  }
  async submissionHistory(userId: string, slug: string, assignmentId: string) {
    const detail = await this.workspaces.detail(userId, slug);
    const canReview =
      detail.currentMembership.role === 'owner' ||
      detail.currentMembership.permissions.review_submission;
    if (
      !(await this.content.assignmentExists(
        detail.id,
        assignmentId,
        canReview ? undefined : detail.currentMembership.id,
      ))
    )
      throw new NotFound('Bài giao', assignmentId);
    const rows = await this.content.submissionHistory(detail.id, assignmentId);
    const runDetails = (await this.mongo
      .collection('submission_run_details')
      .find(
        { submissionId: { $in: rows.map((row) => row.id) } },
        { projection: { submissionId: 1, compile: 1, cases: 1, consoleOutput: 1, judge: 1 } },
      )
      .toArray()) as Record<string, unknown>[];
    const bySubmission = new Map(runDetails.map((item) => [item.submissionId as string, item]));
    return {
      items: rows.map((row) => ({ ...row, runDetail: bySubmission.get(row.id) ?? null })),
      canReview,
    };
  }
  async updateAssignment(
    userId: string,
    slug: string,
    id: string,
    dto: UpdateWorkspaceAssignmentDto,
  ) {
    const detail = await this.workspaces.detail(userId, slug);
    const canReview =
      detail.currentMembership.role === 'owner' ||
      detail.currentMembership.permissions.review_submission;
    if ((dto.reviewStatus !== undefined || dto.feedback !== undefined) && !canReview)
      throw new NotAuthorized('Bạn không có quyền duyệt bài nộp');
    if (!canReview && dto.status === undefined)
      throw new NotAuthorized('Bạn không có quyền cập nhật bài giao');
    if (!canReview && dto.status !== 'notstarted' && dto.status !== 'inprogress')
      throw new BusinessRuleViolation('Trạng thái hoàn thành chỉ được cập nhật từ bài nộp');
    const updated = await this.content.updateAssignment(detail.id, id, {
      status: dto.status,
      reviewStatus: dto.reviewStatus,
      feedback: dto.feedback,
      reviewedBy: canReview && dto.reviewStatus ? userId : undefined,
      memberId: canReview ? undefined : detail.currentMembership.id,
    });
    if (!updated) throw new NotFound('Bài giao', id);
    return { updated: true };
  }

  private async publishAssignmentCreated(
    detail: Detail,
    assignment: {
      groupExerciseId: string;
      exerciseId: string;
      exerciseTitle: string;
      memberIds: string[];
      dueAt: Date | null;
    },
  ) {
    if (assignment.memberIds.length === 0) return;
    const memberExternalIds = await this.content.assignmentNotificationRecipients(
      detail.id,
      assignment.memberIds,
    );
    if (memberExternalIds.length === 0) return;
    try {
      await this.events.publish(TOPICS.ASSIGNMENT_CREATED, {
        groupId: detail.id,
        workspaceSlug: detail.slug,
        workspaceName: detail.name,
        groupExerciseId: assignment.groupExerciseId,
        exerciseId: assignment.exerciseId,
        memberIds: assignment.memberIds,
        memberExternalIds,
        exerciseTitle: assignment.exerciseTitle,
        dueAt: assignment.dueAt?.toISOString() ?? null,
      });
    } catch (error) {
      this.logger.error('Không phát được thông báo bài tập mới', error as Error);
    }
  }

  private require(detail: Detail, permission: keyof Detail['currentMembership']['permissions']) {
    if (
      detail.currentMembership.role !== 'owner' &&
      !detail.currentMembership.permissions[permission]
    )
      throw new NotAuthorized('Bạn không có quyền thực hiện thao tác này');
  }

  private canAny(
    detail: Detail,
    permissions: Array<keyof Detail['currentMembership']['permissions']>,
  ) {
    return (
      detail.currentMembership.role === 'owner' ||
      permissions.some((permission) => detail.currentMembership.permissions[permission])
    );
  }

  private requireAny(
    detail: Detail,
    permissions: Array<keyof Detail['currentMembership']['permissions']>,
  ) {
    if (!this.canAny(detail, permissions))
      throw new NotAuthorized('Bạn không có quyền thực hiện thao tác này');
  }
}

function clean(value: string | null | undefined) {
  return value?.trim() || undefined;
}

/** Never send judge-only test cases, reference solutions or custom checker source to learners. */
function toLearnerExerciseContent(content: Record<string, unknown>) {
  const { testCases, languages, evaluation, ...safe } = content;
  return {
    ...safe,
    ...(Array.isArray(testCases)
      ? {
          testCases: testCases
            .filter(isRecord)
            .filter((testCase) => testCase.visibility === 'public')
            .map((testCase) => ({ ...testCase })),
        }
      : {}),
    ...(Array.isArray(languages)
      ? {
          languages: languages.filter(isRecord).map((language) => {
            const learnerLanguage = { ...language };
            delete learnerLanguage.referenceSolution;
            return learnerLanguage;
          }),
        }
      : {}),
    ...(isRecord(evaluation)
      ? {
          evaluation: {
            checker: evaluation.checker,
            floatTolerance: evaluation.floatTolerance,
            stopOnFirstFailure: evaluation.stopOnFirstFailure,
          },
        }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

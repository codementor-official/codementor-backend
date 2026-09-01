import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { randomUUID } from 'node:crypto';
import {
  assignment_status,
  document_status,
  exercise_difficulty,
  exercise_kind,
  exercise_source,
  exercise_status,
  exercise_visibility,
  member_status,
  review_status,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '@codementor/platform';
import type {
  WorkspaceContentRepository,
  WorkspaceDocumentRecord,
} from '../domain/port/workspace-content.repository';

type DocumentRow = Prisma.group_documentsGetPayload<{
  include: { users_group_documents_uploader_idTousers: { select: { display_name: true } } };
}>;
type ExerciseRow = Prisma.group_exercisesGetPayload<{
  include: {
    exercises: true;
    assignments: {
      include: {
        submissions: { select: { verdict: true } };
        _count: { select: { submissions: true } };
      };
    };
  };
}>;

@Injectable()
export class PrismaWorkspaceContentRepository implements WorkspaceContentRepository {
  constructor(
    private readonly prisma: PrismaService,
    @InjectConnection() private readonly mongo: Connection,
  ) {}

  async listDocuments(
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
  ) {
    const where: Prisma.group_documentsWhereInput = {
      group_id: groupId,
      deleted_at: input.removedOnly ? { not: null } : null,
    };
    if (input.publishedOnly) where.status = document_status.published;
    else if (input.status && input.status !== 'removed')
      where.status = input.status as document_status;
    if (input.type) where.doc_type = input.type;
    if (input.q)
      where.OR = [
        { title: { contains: input.q, mode: 'insensitive' } },
        { topic: { contains: input.q, mode: 'insensitive' } },
      ];
    const [total, rows] = await Promise.all([
      this.prisma.group_documents.count({ where }),
      this.prisma.group_documents.findMany({
        where,
        orderBy: { uploaded_at: 'desc' },
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        include: { users_group_documents_uploader_idTousers: { select: { display_name: true } } },
      }),
    ]);
    return {
      items: rows.map((row) => this.document(row)),
      page: input.page,
      limit: input.limit,
      total,
      totalPages: Math.ceil(total / input.limit),
    };
  }

  async createDocument(
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
  ) {
    const row = await this.prisma.group_documents.create({
      data: {
        group_id: groupId,
        title: input.title,
        doc_type: input.docType,
        topic: input.topic,
        uploader_id: input.uploaderId,
        size_bytes: BigInt(input.sizeBytes),
        storage_key: input.storageKey,
        url: input.url,
        status: document_status.pending,
      },
      include: { users_group_documents_uploader_idTousers: { select: { display_name: true } } },
    });
    await this.activity(groupId, input.uploaderId, 'đã tải lên tài liệu', 'document', row.id);
    return this.document(row);
  }

  async findDocument(groupId: string, id: string) {
    const row = await this.prisma.group_documents.findFirst({
      where: { id, group_id: groupId },
      include: { users_group_documents_uploader_idTousers: { select: { display_name: true } } },
    });
    return row ? this.document(row) : null;
  }

  async updateDocument(
    groupId: string,
    id: string,
    input: { title?: string; topic?: string | null; status?: string },
  ) {
    const found = await this.prisma.group_documents.findFirst({ where: { id, group_id: groupId } });
    if (!found) return null;
    const row = await this.prisma.group_documents.update({
      where: { id },
      data: {
        title: input.title,
        topic: input.topic,
        status: input.status as document_status | undefined,
      },
      include: { users_group_documents_uploader_idTousers: { select: { display_name: true } } },
    });
    return this.document(row);
  }

  async pendingDocumentCount(groupId: string) {
    return this.prisma.group_documents.count({
      where: { group_id: groupId, status: document_status.pending, deleted_at: null },
    });
  }

  async softDeleteDocument(groupId: string, id: string, userId: string, reason?: string) {
    const result = await this.prisma.group_documents.updateMany({
      where: { id, group_id: groupId, deleted_at: null },
      data: { deleted_at: new Date(), deleted_by: userId, delete_reason: reason },
    });
    return result.count > 0;
  }

  async restoreDocument(groupId: string, id: string) {
    const result = await this.prisma.group_documents.updateMany({
      where: { id, group_id: groupId, deleted_at: { not: null } },
      data: { deleted_at: null, deleted_by: null, delete_reason: null },
    });
    return result.count > 0;
  }

  async purgeDocument(groupId: string, id: string) {
    const found = await this.prisma.group_documents.findFirst({
      where: { id, group_id: groupId, deleted_at: { not: null } },
      include: { users_group_documents_uploader_idTousers: { select: { display_name: true } } },
    });
    if (!found) return null;
    await this.prisma.group_documents.delete({ where: { id } });
    return this.document(found);
  }

  async reportDocument(
    groupId: string,
    documentId: string,
    reporterId: string,
    category: string,
    note?: string,
  ) {
    const row = await this.prisma.workspace_document_reports.create({
      data: {
        group_id: groupId,
        document_id: documentId,
        reporter_id: reporterId,
        category,
        note,
      },
    });
    return { id: row.id, status: row.status, createdAt: row.created_at };
  }

  async approvedDocumentContext(groupId: string, documentIds?: string[]) {
    const rows = await this.prisma.group_documents.findMany({
      where: {
        group_id: groupId,
        status: document_status.published,
        deleted_at: null,
        id: documentIds?.length ? { in: documentIds } : undefined,
      },
      orderBy: { uploaded_at: 'desc' },
      take: 8,
      select: { id: true, title: true, preview_text: true },
    });
    return rows.map((row) => ({ id: row.id, title: row.title, previewText: row.preview_text }));
  }

  async listExercises(
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
  ) {
    const where: Prisma.group_exercisesWhereInput = {
      group_id: groupId,
      deleted_at: input.removedOnly ? { not: null } : null,
    };
    if (input.publishedOnly) {
      where.exercises = { status: { in: [exercise_status.published, exercise_status.closed] } };
      where.publication_status = 'published';
    } else if (
      input.status &&
      input.status !== 'hidden' &&
      input.status !== 'published' &&
      input.status !== 'removed' &&
      Object.values(exercise_status).includes(input.status as exercise_status)
    )
      where.exercises = { status: input.status as exercise_status };
    if (input.status === 'hidden') where.publication_status = 'hidden';
    if (input.status === 'published') where.publication_status = 'published';
    const and: Prisma.group_exercisesWhereInput[] = [];
    if (input.difficulty)
      and.push({ exercises: { difficulty: input.difficulty as exercise_difficulty } });
    if (input.q)
      and.push({
        exercises: {
          OR: [
            { title: { contains: input.q, mode: 'insensitive' } },
            { summary: { contains: input.q, mode: 'insensitive' } },
          ],
        },
      });
    const mine = { member_id: input.memberId };
    if (input.scope === 'assigned') and.push({ assignments: { some: mine } });
    if (input.scope === 'public') and.push({ assignments: { none: mine } });
    if (input.status === 'not_started')
      and.push({ assignments: { some: { ...mine, status: assignment_status.notstarted } } });
    if (input.status === 'in_progress')
      and.push({ assignments: { some: { ...mine, status: assignment_status.inprogress } } });
    if (input.status === 'completed')
      and.push({
        assignments: {
          some: { ...mine, status: { in: [assignment_status.done, assignment_status.late] } },
        },
      });
    if (input.status === 'not_passed')
      and.push({
        assignments: {
          some: { ...mine, submissions: { some: {}, none: { verdict: 'accepted' } } },
        },
      });
    if (input.status === 'due_soon') {
      const until = new Date();
      until.setUTCDate(until.getUTCDate() + 7);
      and.push({
        due_at: { gte: new Date(), lte: until },
        assignments: {
          some: { ...mine, status: { notIn: [assignment_status.done, assignment_status.late] } },
        },
      });
    }
    if (input.status === 'overdue')
      and.push({
        due_at: { lt: new Date() },
        assignments: { some: { ...mine, status: { not: assignment_status.done } } },
      });
    if (and.length) where.AND = and;
    const [total, rows] = await Promise.all([
      this.prisma.group_exercises.count({ where }),
      this.prisma.group_exercises.findMany({
        where,
        orderBy: [{ due_at: 'asc' }, { created_at: 'desc' }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        include: {
          exercises: true,
          assignments: {
            include: {
              submissions: {
                orderBy: { submitted_at: 'desc' },
                take: 1,
                select: { verdict: true },
              },
              _count: { select: { submissions: true } },
            },
          },
        },
      }),
    ]);
    return {
      items: rows.map((row) => {
        const myAssignment = row.assignments.find(
          (assignment) => assignment.member_id === input.memberId,
        );
        return {
          id: row.id,
          exerciseId: row.exercise_id,
          slug: row.exercises.slug,
          title: row.exercises.title,
          summary: row.exercises.summary,
          difficulty: row.exercises.difficulty,
          status: row.exercises.status,
          source: row.exercises.source,
          authorId: row.exercises.author_id,
          publicationStatus: row.publication_status,
          deletedAt: row.deleted_at,
          deletedBy: row.deleted_by,
          deleteReason: row.delete_reason,
          xp: row.exercises.xp_reward,
          estimatedMinutes: row.exercises.estimated_minutes,
          timeLimitMs: row.exercises.time_limit_ms,
          memoryLimitKb: row.exercises.memory_limit_kb,
          publishedAt: row.exercises.published_at,
          updatedAt: row.exercises.updated_at,
          dueAt: row.due_at,
          attemptLimit: row.attempt_limit,
          allowRetry: row.allow_retry,
          allowLateSubmission: row.allow_late_submission,
          phase: row.phase,
          assignedCount: row.assignments.length,
          completedCount: row.assignments.filter(
            (a) => a.status === assignment_status.done || a.status === assignment_status.late,
          ).length,
          isAssignedToMe: Boolean(myAssignment),
          myAssignment: myAssignment
            ? {
                id: myAssignment.id,
                status: myAssignment.status,
                submissionCount: myAssignment._count.submissions,
                latestVerdict: myAssignment.submissions[0]?.verdict ?? null,
              }
            : null,
        };
      }),
      page: input.page,
      limit: input.limit,
      total,
      totalPages: Math.ceil(total / input.limit),
    };
  }

  async attachExercise(
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
  ) {
    return this.prisma.$transaction(async (tx) => {
      const linked = await tx.group_exercises.upsert({
        where: { group_id_exercise_id: { group_id: groupId, exercise_id: input.exerciseId } },
        create: {
          group_id: groupId,
          exercise_id: input.exerciseId,
          assigned_by: userId,
          due_at: input.dueAt,
          attempt_limit: input.attemptLimit,
          allow_retry: input.allowRetry,
          allow_late_submission: input.allowLateSubmission,
        },
        update: {
          due_at: input.dueAt,
          attempt_limit: input.attemptLimit,
          allow_retry: input.allowRetry,
          allow_late_submission: input.allowLateSubmission,
          deleted_at: null,
          deleted_by: null,
          delete_reason: null,
        },
        include: { exercises: { select: { title: true } } },
      });
      const members = await tx.group_members.findMany({
        where: { id: { in: input.memberIds }, group_id: groupId, status: member_status.active },
        select: { id: true },
      });
      await tx.assignments.createMany({
        data: members.map((member) => ({
          group_id: groupId,
          group_exercise_id: linked.id,
          member_id: member.id,
        })),
        skipDuplicates: true,
      });
      await tx.group_activities.create({
        data: {
          group_id: groupId,
          actor_id: userId,
          action: 'đã giao bài tập',
          target_type: 'exercise',
          target_id: linked.id,
        },
      });
      return { groupExerciseId: linked.id, exerciseTitle: linked.exercises.title };
    });
  }

  async assignmentNotificationRecipients(groupId: string, memberIds: string[]) {
    if (memberIds.length === 0) return [];
    const members = await this.prisma.group_members.findMany({
      where: { id: { in: memberIds }, group_id: groupId, status: member_status.active },
      select: { users: { select: { external_id: true } } },
    });
    return members.flatMap((member) =>
      member.users.external_id ? [member.users.external_id] : [],
    );
  }

  async createExercise(
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
  ) {
    const exercise = await this.prisma.exercises.create({
      data: {
        slug: `${slugify(input.slug || input.title)}-${randomUUID().slice(0, 8)}`,
        title: input.title,
        summary: input.summary,
        kind: exercise_kind.code,
        difficulty: input.difficulty as exercise_difficulty,
        status: exercise_status.published,
        source: input.source as exercise_source,
        visibility: exercise_visibility.group,
        xp_reward: input.xpReward,
        estimated_minutes: input.estimatedMinutes,
        time_limit_ms: input.timeLimitMs,
        memory_limit_kb: input.memoryLimitKb,
        author_id: userId,
        published_at: new Date(),
      },
    });
    const now = new Date();
    const content = sanitizeExerciseContent(input.content);
    const contentRow = await this.mongo.collection('exercise_contents').findOneAndUpdate(
      { exerciseId: exercise.id },
      {
        $set: { ...content, kind: 'code', updatedAt: now },
        $setOnInsert: { exerciseId: exercise.id, createdAt: now },
      },
      { upsert: true, returnDocument: 'after', projection: { _id: 1 } },
    );
    if (!contentRow?._id) throw new Error('Không lưu được nội dung bài tập');
    await this.prisma.exercises.update({
      where: { id: exercise.id },
      data: { content_ref: contentRow._id.toString() },
    });
    await this.attachExercise(groupId, userId, {
      exerciseId: exercise.id,
      dueAt: input.dueAt,
      attemptLimit: input.attemptLimit,
      allowRetry: input.allowRetry,
      allowLateSubmission: input.allowLateSubmission,
      memberIds: input.memberIds,
    });
    const linked = await this.prisma.group_exercises.findUniqueOrThrow({
      where: { group_id_exercise_id: { group_id: groupId, exercise_id: exercise.id } },
      include: {
        exercises: true,
        assignments: {
          include: {
            submissions: { orderBy: { submitted_at: 'desc' }, take: 1, select: { verdict: true } },
            _count: { select: { submissions: true } },
          },
        },
      },
    });
    return this.exercise(linked, '');
  }

  async duplicateExercise(groupId: string, id: string, userId: string) {
    const source = await this.prisma.group_exercises.findFirst({
      where: { id, group_id: groupId, deleted_at: null },
      include: { exercises: true, assignments: { select: { member_id: true } } },
    });
    if (!source) return null;
    const content = await this.mongo
      .collection('exercise_contents')
      .findOne(
        { exerciseId: source.exercise_id },
        { projection: { _id: 0, exerciseId: 0, kind: 0, createdAt: 0, updatedAt: 0 } },
      );
    return this.createExercise(groupId, userId, {
      title: `${source.exercises.title} (Bản sao)`,
      summary: source.exercises.summary ?? undefined,
      difficulty: source.exercises.difficulty,
      source: 'manual',
      xpReward: source.exercises.xp_reward,
      timeLimitMs: source.exercises.time_limit_ms,
      memoryLimitKb: source.exercises.memory_limit_kb,
      content: (content as Record<string, unknown> | null) ?? {},
      dueAt: source.due_at ?? undefined,
      attemptLimit: source.attempt_limit ?? undefined,
      allowRetry: source.allow_retry,
      allowLateSubmission: source.allow_late_submission,
      memberIds: source.assignments.map((item) => item.member_id),
    });
  }

  async exerciseDetail(groupId: string, id: string) {
    const row = await this.prisma.group_exercises.findFirst({
      where: { id, group_id: groupId, deleted_at: null },
      include: {
        exercises: true,
        assignments: {
          select: { member_id: true, status: true },
        },
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      exerciseId: row.exercise_id,
      slug: row.exercises.slug,
      title: row.exercises.title,
      summary: row.exercises.summary,
      difficulty: row.exercises.difficulty,
      status: row.exercises.status,
      source: row.exercises.source,
      authorId: row.exercises.author_id,
      publicationStatus: row.publication_status,
      deletedAt: row.deleted_at,
      deletedBy: row.deleted_by,
      deleteReason: row.delete_reason,
      xp: row.exercises.xp_reward,
      estimatedMinutes: row.exercises.estimated_minutes,
      timeLimitMs: row.exercises.time_limit_ms,
      memoryLimitKb: row.exercises.memory_limit_kb,
      publishedAt: row.exercises.published_at,
      updatedAt: row.exercises.updated_at,
      dueAt: row.due_at,
      attemptLimit: row.attempt_limit,
      allowRetry: row.allow_retry,
      allowLateSubmission: row.allow_late_submission,
      phase: row.phase,
      assignedCount: row.assignments.length,
      completedCount: row.assignments.filter(
        (a) => a.status === assignment_status.done || a.status === assignment_status.late,
      ).length,
      isAssignedToMe: false,
      myAssignment: null,
      assignmentMemberIds: row.assignments.map((assignment) => assignment.member_id),
    };
  }

  async publicExerciseExists(exerciseId: string) {
    return (
      (await this.prisma.exercises.count({
        where: { id: exerciseId, status: exercise_status.published },
      })) > 0
    );
  }

  async updateExercise(
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
  ) {
    const found = await this.prisma.group_exercises.findFirst({
      where: { id, group_id: groupId, deleted_at: null },
    });
    if (!found) return false;
    await this.prisma.$transaction(async (tx) => {
      await tx.group_exercises.update({
        where: { id },
        data: {
          due_at: input.dueAt,
          attempt_limit: input.attemptLimit,
          allow_retry: input.allowRetry,
          allow_late_submission: input.allowLateSubmission,
          publication_status: input.publicationStatus,
        },
      });
      if (
        input.title !== undefined ||
        input.summary !== undefined ||
        input.difficulty !== undefined ||
        input.estimatedMinutes !== undefined ||
        input.timeLimitMs !== undefined ||
        input.memoryLimitKb !== undefined
      )
        await tx.exercises.update({
          where: { id: found.exercise_id },
          data: {
            title: input.title,
            summary: input.summary,
            difficulty: input.difficulty as exercise_difficulty | undefined,
            estimated_minutes: input.estimatedMinutes,
            time_limit_ms: input.timeLimitMs,
            memory_limit_kb: input.memoryLimitKb,
          },
        });
      if (input.memberIds) {
        const members = await tx.group_members.findMany({
          where: { id: { in: input.memberIds }, group_id: groupId, status: member_status.active },
          select: { id: true },
        });
        await tx.assignments.deleteMany({
          where: { group_id: groupId, group_exercise_id: id, submissions: { none: {} } },
        });
        await tx.assignments.createMany({
          data: members.map((member) => ({
            group_id: groupId,
            group_exercise_id: id,
            member_id: member.id,
          })),
          skipDuplicates: true,
        });
      }
    });
    if (input.content) {
      const now = new Date();
      const contentRow = await this.mongo.collection('exercise_contents').findOneAndUpdate(
        { exerciseId: found.exercise_id },
        {
          $set: { ...sanitizeExerciseContent(input.content), kind: 'code', updatedAt: now },
          $setOnInsert: { exerciseId: found.exercise_id, createdAt: now },
        },
        { upsert: true, returnDocument: 'after', projection: { _id: 1 } },
      );
      if (contentRow?._id)
        await this.prisma.exercises.update({
          where: { id: found.exercise_id },
          data: { content_ref: contentRow._id.toString() },
        });
    }
    return true;
  }
  async exerciseHasSubmissions(groupId: string, id: string) {
    return (
      (await this.prisma.submissions.count({
        where: { assignments: { group_id: groupId, group_exercise_id: id } },
      })) > 0
    );
  }
  async softDeleteExercise(groupId: string, id: string, userId: string, reason?: string) {
    const result = await this.prisma.group_exercises.updateMany({
      where: { id, group_id: groupId, deleted_at: null },
      data: { deleted_at: new Date(), deleted_by: userId, delete_reason: reason },
    });
    return result.count > 0;
  }
  async restoreExercise(groupId: string, id: string) {
    const result = await this.prisma.group_exercises.updateMany({
      where: { id, group_id: groupId, deleted_at: { not: null } },
      data: { deleted_at: null, deleted_by: null, delete_reason: null },
    });
    return result.count > 0;
  }
  async purgeExercise(groupId: string, id: string) {
    const found = await this.prisma.group_exercises.findFirst({
      where: { id, group_id: groupId, deleted_at: { not: null } },
      select: { exercise_id: true, exercises: { select: { visibility: true } } },
    });
    if (!found) return false;
    const result = await this.prisma.group_exercises.deleteMany({
      where: { id, group_id: groupId, deleted_at: { not: null } },
    });
    if (result.count > 0 && found.exercises.visibility === exercise_visibility.group) {
      const references = await this.prisma.group_exercises.count({
        where: { exercise_id: found.exercise_id },
      });
      if (references === 0) {
        await this.prisma.exercises.delete({ where: { id: found.exercise_id } });
        await this.mongo
          .collection('exercise_contents')
          .deleteOne({ exerciseId: found.exercise_id });
      }
    }
    return result.count > 0;
  }

  async listAssignments(
    groupId: string,
    input: {
      page: number;
      limit: number;
      q?: string;
      status?: string;
      memberId?: string;
      groupExerciseId?: string;
    },
  ) {
    const where: Prisma.assignmentsWhereInput = { group_id: groupId };
    if (input.status) where.status = input.status as assignment_status;
    if (input.memberId) where.member_id = input.memberId;
    if (input.groupExerciseId) where.group_exercise_id = input.groupExerciseId;
    if (input.q)
      where.OR = [
        { group_exercises: { exercises: { title: { contains: input.q, mode: 'insensitive' } } } },
        { group_members: { users: { display_name: { contains: input.q, mode: 'insensitive' } } } },
      ];
    const [total, rows] = await Promise.all([
      this.prisma.assignments.count({ where }),
      this.prisma.assignments.findMany({
        where,
        orderBy: [{ submissions: { _count: 'desc' } }, { updated_at: 'desc' }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        include: {
          group_exercises: {
            include: { exercises: { select: { id: true, slug: true, title: true } } },
          },
          group_members: { include: { users: { select: { display_name: true } } } },
          submissions: {
            orderBy: { submitted_at: 'desc' },
            take: 1,
            select: {
              verdict: true,
              score: true,
              attempt_number: true,
              is_late: true,
              submitted_at: true,
            },
          },
          _count: { select: { submissions: true } },
        },
      }),
    ]);
    return {
      items: rows.map((row) => this.assignment(row)),
      page: input.page,
      limit: input.limit,
      total,
      totalPages: Math.ceil(total / input.limit),
    };
  }

  async assignmentSubmissionContext(assignmentId: string, userId: string) {
    const assignment = await this.prisma.assignments.findFirst({
      where: {
        id: assignmentId,
        group_members: { user_id: userId, status: member_status.active },
        group_exercises: { deleted_at: null, publication_status: 'published' },
      },
      select: {
        id: true,
        _count: { select: { submissions: true } },
        group_exercises: {
          select: {
            exercise_id: true,
            due_at: true,
            attempt_limit: true,
            allow_retry: true,
            allow_late_submission: true,
          },
        },
      },
    });
    if (!assignment) return null;
    return {
      assignmentId: assignment.id,
      exerciseId: assignment.group_exercises.exercise_id,
      dueAt: assignment.group_exercises.due_at,
      attemptLimit: assignment.group_exercises.attempt_limit,
      allowRetry: assignment.group_exercises.allow_retry,
      allowLateSubmission: assignment.group_exercises.allow_late_submission,
      submissionCount: assignment._count.submissions,
    };
  }

  async assignmentExists(groupId: string, id: string, memberId?: string) {
    return (
      (await this.prisma.assignments.count({
        where: { id, group_id: groupId, member_id: memberId },
      })) > 0
    );
  }
  async submissionHistory(groupId: string, assignmentId: string) {
    const rows = await this.prisma.submissions.findMany({
      where: { assignment_id: assignmentId, assignments: { group_id: groupId } },
      orderBy: { attempt_number: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      language: row.language,
      sourceCode: row.source_code,
      verdict: row.verdict,
      score: row.score,
      passedTests: row.passed_tests,
      totalTests: row.total_tests,
      runtimeMs: row.runtime_ms,
      memoryKb: row.memory_kb,
      attemptNumber: row.attempt_number,
      isLate: row.is_late,
      note: row.note,
      runDetailRef: row.run_detail_ref,
      submittedAt: row.submitted_at,
    }));
  }

  async updateAssignment(
    groupId: string,
    id: string,
    input: {
      status?: string;
      reviewStatus?: string;
      feedback?: string | null;
      reviewedBy?: string;
      memberId?: string;
    },
  ) {
    const result = await this.prisma.assignments.updateMany({
      where: { id, group_id: groupId, member_id: input.memberId },
      data: {
        status: input.status as assignment_status | undefined,
        review_status: input.reviewStatus as review_status | undefined,
        feedback: input.feedback,
        reviewed_by: input.reviewedBy,
        reviewed_at: input.reviewStatus ? new Date() : undefined,
        started_at: input.status === assignment_status.inprogress ? new Date() : undefined,
      },
    });
    return result.count > 0;
  }

  private document(row: DocumentRow): WorkspaceDocumentRecord {
    return {
      id: row.id,
      title: row.title,
      docType: row.doc_type,
      topic: row.topic,
      uploaderId: row.uploader_id,
      uploaderName: row.users_group_documents_uploader_idTousers?.display_name ?? null,
      sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
      storageKey: row.storage_key,
      url: row.url,
      previewText: row.preview_text,
      status: row.deleted_at ? 'removed' : row.status,
      aiVerdict: row.ai_verdict,
      uploadedAt: row.uploaded_at,
      deletedAt: row.deleted_at,
      deletedBy: row.deleted_by,
      deleteReason: row.delete_reason,
    };
  }

  private exercise(row: ExerciseRow, memberId: string) {
    const myAssignment = row.assignments.find((assignment) => assignment.member_id === memberId);
    return {
      id: row.id,
      exerciseId: row.exercise_id,
      slug: row.exercises.slug,
      title: row.exercises.title,
      summary: row.exercises.summary,
      difficulty: row.exercises.difficulty,
      status: row.exercises.status,
      source: row.exercises.source,
      authorId: row.exercises.author_id,
      publicationStatus: row.publication_status,
      deletedAt: row.deleted_at,
      deletedBy: row.deleted_by,
      deleteReason: row.delete_reason,
      xp: row.exercises.xp_reward,
      estimatedMinutes: row.exercises.estimated_minutes,
      timeLimitMs: row.exercises.time_limit_ms,
      memoryLimitKb: row.exercises.memory_limit_kb,
      publishedAt: row.exercises.published_at,
      updatedAt: row.exercises.updated_at,
      dueAt: row.due_at,
      attemptLimit: row.attempt_limit,
      allowRetry: row.allow_retry,
      allowLateSubmission: row.allow_late_submission,
      phase: row.phase,
      assignedCount: row.assignments.length,
      completedCount: row.assignments.filter(
        (item) => item.status === assignment_status.done || item.status === assignment_status.late,
      ).length,
      isAssignedToMe: Boolean(myAssignment),
      myAssignment: myAssignment
        ? {
            id: myAssignment.id,
            status: myAssignment.status,
            submissionCount: myAssignment._count.submissions,
            latestVerdict: myAssignment.submissions[0]?.verdict ?? null,
          }
        : null,
    };
  }
  private assignment(row: {
    id: string;
    group_exercise_id: string;
    member_id: string;
    status: assignment_status;
    review_status: review_status;
    feedback: string | null;
    started_at: Date | null;
    updated_at: Date;
    group_exercises: {
      due_at: Date | null;
      exercises: { id: string; slug: string; title: string };
    };
    group_members: { users: { display_name: string } };
    submissions: {
      verdict: string;
      score: number | null;
      attempt_number: number;
      is_late: boolean;
      submitted_at: Date;
    }[];
    _count: { submissions: number };
  }) {
    return {
      id: row.id,
      groupExerciseId: row.group_exercise_id,
      exerciseId: row.group_exercises.exercises.id,
      exerciseSlug: row.group_exercises.exercises.slug,
      exerciseTitle: row.group_exercises.exercises.title,
      dueAt: row.group_exercises.due_at,
      memberId: row.member_id,
      memberName: row.group_members.users.display_name,
      status: row.status,
      reviewStatus: row.review_status,
      feedback: row.feedback,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      submissionCount: row._count.submissions,
      latestVerdict: row.submissions[0]?.verdict ?? null,
      latestScore: row.submissions[0]?.score ?? null,
      latestAttemptNumber: row.submissions[0]?.attempt_number ?? null,
      latestIsLate: row.submissions[0]?.is_late ?? false,
      latestSubmittedAt: row.submissions[0]?.submitted_at ?? null,
    };
  }
  private async activity(
    groupId: string,
    actorId: string,
    action: string,
    targetType: string,
    targetId: string,
  ) {
    await this.prisma.group_activities.create({
      data: {
        group_id: groupId,
        actor_id: actorId,
        action,
        target_type: targetType,
        target_id: targetId,
      },
    });
  }
}

function slugify(value: string) {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'workspace-exercise'
  );
}

function sanitizeExerciseContent(input: Record<string, unknown>) {
  const allowed = [
    'statement',
    'ioMode',
    'signature',
    'constraints',
    'hints',
    'examples',
    'testCases',
    'languages',
    'evaluation',
    'theory',
  ];
  return Object.fromEntries(
    allowed.flatMap((key) => (input[key] === undefined ? [] : [[key, input[key]]])),
  );
}

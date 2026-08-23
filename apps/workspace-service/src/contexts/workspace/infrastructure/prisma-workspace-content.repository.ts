import { Injectable } from '@nestjs/common';
import {
  assignment_status,
  document_status,
  exercise_difficulty,
  exercise_status,
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

@Injectable()
export class PrismaWorkspaceContentRepository implements WorkspaceContentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listDocuments(
    groupId: string,
    input: {
      page: number;
      limit: number;
      q?: string;
      status?: string;
      type?: string;
      publishedOnly: boolean;
    },
  ) {
    const where: Prisma.group_documentsWhereInput = { group_id: groupId };
    if (input.publishedOnly) where.status = document_status.published;
    else if (input.status) where.status = input.status as document_status;
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

  async deleteDocument(groupId: string, id: string) {
    const found = await this.prisma.group_documents.findFirst({
      where: { id, group_id: groupId },
      include: { users_group_documents_uploader_idTousers: { select: { display_name: true } } },
    });
    if (!found) return null;
    await this.prisma.group_documents.delete({ where: { id } });
    return this.document(found);
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
    },
  ) {
    const where: Prisma.group_exercisesWhereInput = { group_id: groupId };
    if (input.publishedOnly)
      where.exercises = { status: { in: [exercise_status.published, exercise_status.closed] } };
    else if (
      input.status &&
      Object.values(exercise_status).includes(input.status as exercise_status)
    )
      where.exercises = { status: input.status as exercise_status };
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
          xp: row.exercises.xp_reward,
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
    await this.prisma.$transaction(async (tx) => {
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
        },
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
    });
  }

  async exerciseDetail(groupId: string, id: string) {
    const row = await this.prisma.group_exercises.findFirst({
      where: { id, group_id: groupId },
      include: {
        exercises: true,
        assignments: {
          orderBy: { created_at: 'asc' },
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
      xp: row.exercises.xp_reward,
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
      assignments: row.assignments.map((assignment) => this.assignment(assignment)),
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
    },
  ) {
    const found = await this.prisma.group_exercises.findFirst({ where: { id, group_id: groupId } });
    if (!found) return false;
    await this.prisma.$transaction(async (tx) => {
      await tx.group_exercises.update({
        where: { id },
        data: {
          due_at: input.dueAt,
          attempt_limit: input.attemptLimit,
          allow_retry: input.allowRetry,
          allow_late_submission: input.allowLateSubmission,
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
    return true;
  }
  async exerciseHasSubmissions(groupId: string, id: string) {
    return (
      (await this.prisma.submissions.count({
        where: { assignments: { group_id: groupId, group_exercise_id: id } },
      })) > 0
    );
  }
  async deleteExercise(groupId: string, id: string) {
    const result = await this.prisma.group_exercises.deleteMany({
      where: { id, group_id: groupId },
    });
    return result.count > 0;
  }

  async listAssignments(
    groupId: string,
    input: { page: number; limit: number; q?: string; status?: string; memberId?: string },
  ) {
    const where: Prisma.assignmentsWhereInput = { group_id: groupId };
    if (input.status) where.status = input.status as assignment_status;
    if (input.memberId) where.member_id = input.memberId;
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
      status: row.status,
      aiVerdict: row.ai_verdict,
      uploadedAt: row.uploaded_at,
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
    group_exercises: { exercises: { id: string; slug: string; title: string } };
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

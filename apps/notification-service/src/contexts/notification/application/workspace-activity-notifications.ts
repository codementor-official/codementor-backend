import { Injectable } from '@nestjs/common';
import type { AssignmentReviewedV1, EventEnvelope, WorkspaceActivityV1 } from '@codementor/contracts';
import { NotificationContent, type NotificationType } from '../domain/model/notification-content';
import { WorkspaceActivityRepository } from '../infrastructure/workspace-activity.repository';
import { ReminderRepository } from '../infrastructure/reminder.repository';
import { RecordNotificationUseCase } from './record-notification.usecase';

@Injectable()
export class WorkspaceActivityNotifications {
  constructor(
    private readonly repo: WorkspaceActivityRepository,
    private readonly recipients: ReminderRepository,
    private readonly record: RecordNotificationUseCase,
  ) {}
  async assignmentReviewed(payload: AssignmentReviewedV1, envelope: EventEnvelope<unknown>) {
    const assignment = await this.recipients.assignment(payload.assignmentId);
    if (!assignment?.eligible || assignment.group_id !== payload.groupId || assignment.review_status !== payload.reviewStatus) return;
    const user = await this.recipients.recipient(assignment.user_id);
    if (!user?.external_id || user.id === payload.reviewedBy) return;
    await this.record.record(envelope, NotificationContent.create({
      type: 'WORKSPACE_ASSIGNMENT_REVIEWED', audienceType: 'USER', audienceKey: user.external_id,
      title: payload.reviewStatus === 'approved' ? 'Bài nộp đã được duyệt' : 'Bài nộp cần chỉnh sửa',
      message: `Bài “${assignment.exercise_title}” trong nhóm “${assignment.workspace_name}” đã có phản hồi.`,
      referenceType: 'WORKSPACE', referenceId: assignment.group_id,
      actionUrl: `/workspace/${assignment.workspace_slug}?tab=exercises&groupExerciseId=${assignment.group_exercise_id}`,
      actionLabel: 'Xem bài nộp',
    }));
  }
  async handle(payload: WorkspaceActivityV1, envelope: EventEnvelope<unknown>) {
    const workspace = await this.repo.workspace(payload.groupId);
    if (!workspace) return;
    const members = await this.repo.members(payload.groupId);
    let targets = members.filter((m) => m.status === 'active' && m.user_id !== payload.actorUserId && m.external_id);
    let type: NotificationType;
    let title: string;
    let message: string;
    let actionUrl = `/workspace/${workspace.slug}?tab=members`;
    if (payload.action.startsWith('document_')) {
      const document = await this.repo.document(payload.groupId, payload.entityId);
      if (!document) return;
      // Re-check current state/permissions when consuming, not just when the event was emitted.
      if (payload.action === 'document_pending') {
        if (document.status !== 'pending' || document.deleted_at) return;
        targets = targets.filter((m) => m.can_view_doc && m.can_approve_doc && m.user_id !== document.uploader_id);
        type = 'WORKSPACE_DOCUMENT_PENDING'; title = 'Có tài liệu đang chờ duyệt';
        message = `Tài liệu “${document.title}” trong nhóm “${workspace.name}” cần được duyệt.`;
      } else if (payload.action === 'document_published') {
        if (document.status !== 'published' || document.deleted_at) return;
        targets = targets.filter((m) => m.can_view_doc);
        type = 'WORKSPACE_DOCUMENT_PUBLISHED'; title = 'Nhóm có tài liệu mới';
        message = `Tài liệu “${document.title}” đã được chia sẻ trong nhóm “${workspace.name}”.`;
      } else if (payload.action === 'document_deleted') {
        if (!document.deleted_at) return;
        targets = targets.filter((m) => m.user_id === document.uploader_id);
        type = 'WORKSPACE_DOCUMENT_REJECTED'; title = 'Tài liệu đã được chuyển vào mục đã xóa';
        message = `Tài liệu “${document.title}” trong nhóm “${workspace.name}” đã bị xóa mềm và có thể khôi phục trong 30 ngày.`;
      } else {
        if (!['hidden', 'rejected', 'changes'].includes(document.status) || document.deleted_at) return;
        targets = targets.filter((m) => m.user_id === document.uploader_id);
        type = 'WORKSPACE_DOCUMENT_REJECTED'; title = payload.action === 'document_hidden' ? 'Tài liệu đã bị ẩn' : 'Tài liệu cần được xem lại';
        message = `Tài liệu “${document.title}” trong nhóm “${workspace.name}” chưa được hiển thị.`;
      }
      if (payload.reason) message += ` Lý do: ${payload.reason}`;
      actionUrl = `/workspace/${workspace.slug}?tab=documents`;
    } else if (payload.action.startsWith('exercise_')) {
      const exercise = await this.repo.exercise(payload.groupId, payload.entityId);
      if (!exercise) return;
      if (payload.action === 'exercise_deleted' && !exercise.deleted_at) return;
      if (payload.action === 'exercise_hidden' && exercise.publication_status !== 'hidden') return;
      targets = targets.filter((m) => m.user_id === exercise.author_id);
      type = 'WORKSPACE_EXERCISE_UPDATED';
      title = payload.action === 'exercise_deleted' ? 'Bài tập đã được chuyển vào mục đã xóa' : 'Bài tập đã bị ẩn';
      message = `Bài “${exercise.title}” trong nhóm “${workspace.name}” đã được cập nhật bởi quản trị nhóm.`;
      if (payload.reason) message += ` Lý do: ${payload.reason}`;
      actionUrl = `/workspace/${workspace.slug}?tab=exercises`;
    } else {
      const changed = payload.memberUserId ? await this.recipients.recipient(payload.memberUserId) : undefined;
      const name = changed?.display_name ?? 'Một thành viên';
      if (payload.action === 'join_requested') {
        if (!(await this.repo.pendingRequest(payload.groupId, payload.entityId))) return;
        targets = targets.filter((m) => m.role === 'owner');
        type = 'WORKSPACE_JOIN_REQUESTED'; title = 'Có yêu cầu tham gia nhóm';
        message = `${name} muốn tham gia nhóm “${workspace.name}”.`;
      } else if (payload.action === 'member_joined') {
        if (!members.some((m) => m.user_id === payload.memberUserId && m.status === 'active')) return;
        targets = targets.filter((m) => m.user_id !== payload.memberUserId);
        type = 'WORKSPACE_MEMBER_JOINED'; title = 'Nhóm có thành viên mới';
        message = `${name} đã tham gia nhóm “${workspace.name}”.`;
      } else if (payload.action === 'member_left' || payload.action === 'member_removed') {
        if (members.some((m) => m.user_id === payload.memberUserId && m.status === 'active')) return;
        targets = payload.action === 'member_removed'
          ? (changed?.external_id ? [{ user_id: payload.memberUserId!, external_id: changed.external_id, display_name: changed.display_name, role: 'member', status: 'removed', can_view_doc: false, can_approve_doc: false }] : [])
          : targets.filter((m) => m.user_id !== payload.memberUserId);
        type = 'WORKSPACE_MEMBER_LEFT'; title = 'Cập nhật thành viên nhóm';
        message = payload.action === 'member_removed'
          ? `Bạn đã được xóa khỏi nhóm “${workspace.name}”.${payload.reason ? ` Lý do: ${payload.reason}` : ''}`
          : `${name} không còn là thành viên nhóm “${workspace.name}”.`;
      } else {
        if (!members.some((m) => m.user_id === payload.memberUserId && m.status === 'active' && m.role === payload.role)) return;
        targets = targets.filter((m) => m.user_id === payload.memberUserId || m.role === 'owner');
        type = 'WORKSPACE_MEMBER_ROLE_CHANGED'; title = 'Vai trò thành viên đã thay đổi';
        const role = { owner: 'Chủ nhóm', deputy: 'Phó nhóm', member: 'Thành viên' }[payload.role ?? 'member'] ?? 'Thành viên';
        message = `${name} hiện là ${role} trong nhóm “${workspace.name}”.`;
      }
    }
    for (const target of targets) {
      // Publish/restore of the same document must not spam "new document" again.
      const eventId = payload.action === 'document_published'
        ? `document-published:${payload.entityId}:${target.external_id}`
        : `${envelope.eventId}:${target.external_id}`;
      await this.record.record({ ...envelope, eventId }, NotificationContent.create({
        type, title, message, audienceType: 'USER', audienceKey: target.external_id,
        referenceType: 'WORKSPACE', referenceId: workspace.id,
        actionUrl, actionLabel: 'Mở nhóm học tập',
        metadata: { entityId: payload.entityId, action: payload.action },
      }));
    }
  }
}

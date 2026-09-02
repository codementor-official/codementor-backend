import { Injectable } from '@nestjs/common';
import { PrismaService } from '@codementor/platform';

export interface ActivityMember {
  user_id: string; external_id: string | null; display_name: string;
  role: string; status: string; can_view_doc: boolean; can_approve_doc: boolean;
}
export interface ActivityDocument {
  id: string; group_id: string; title: string; status: string;
  uploader_id: string | null; reviewed_by: string | null; deleted_at: Date | null;
}
@Injectable()
export class WorkspaceActivityRepository {
  constructor(private readonly db: PrismaService) {}
  async workspace(id: string) {
    return (await this.db.$queryRawUnsafe<{ id: string; name: string; slug: string }[]>(
      'SELECT * FROM notification_workspace_activity_context WHERE id=$1::uuid', id,
    ))[0];
  }
  members(id: string): Promise<ActivityMember[]> {
    return this.db.$queryRawUnsafe('SELECT * FROM notification_workspace_member_context WHERE group_id=$1::uuid', id);
  }
  async document(groupId: string, id: string) {
    return (await this.db.$queryRawUnsafe<ActivityDocument[]>(
      'SELECT * FROM notification_workspace_document_context WHERE group_id=$1::uuid AND id=$2::uuid', groupId, id,
    ))[0];
  }
  async pendingRequest(groupId: string, id: string) {
    return (await this.db.$queryRawUnsafe<{ user_id: string }[]>(
      "SELECT user_id FROM notification_workspace_join_request_context WHERE group_id=$1::uuid AND id=$2::uuid AND status='pending'", groupId, id,
    ))[0];
  }
}

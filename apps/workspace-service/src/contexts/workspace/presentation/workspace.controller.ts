import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, requireHumanId } from '@codementor/platform';
import type { AuthenticatedUser } from '@codementor/platform';
import { WorkspaceService } from '../application/workspace.service';
import { WorkspaceOverviewService } from '../application/workspace-overview.service';
import { WorkspaceContentService } from '../application/workspace-content.service';
import { WorkspaceChatService } from '../application/workspace-chat.service';
import {
  CreateWorkspaceDto,
  CreateWorkspaceExerciseDto,
  AttachWorkspaceExerciseDto,
  CreateWorkspaceDocumentDto,
  DocumentUploadUrlDto,
  GenerateWorkspaceExerciseDraftDto,
  InviteWorkspaceMemberDto,
  JoinWorkspaceDto,
  ListJoinRequestsQueryDto,
  ListMembersQueryDto,
  ListWorkspacesQueryDto,
  RequestWorkspaceJoinDto,
  RemoveWorkspaceContentDto,
  ReportWorkspaceDocumentDto,
  TransferOwnershipDto,
  UpdateMemberPermissionsDto,
  UpdateMemberRoleDto,
  UpdateRolePermissionsDto,
  UpdateWorkspaceDto,
  UpdateWorkspaceAssignmentDto,
  UpdateWorkspaceDocumentDto,
  UpdateWorkspaceExerciseDto,
  WorkspaceContentQueryDto,
  WorkspaceOverviewQueryDto,
  WorkspaceAssetUploadUrlDto,
  CreateWorkspaceMessageDto,
  ListWorkspaceMessagesQueryDto,
  UpdateWorkspaceMessageDto,
} from './dto/workspace.dto';

@ApiTags('workspaces')
@ApiBearerAuth('access-token')
@Controller({ path: 'workspaces', version: '1' })
export class WorkspaceController {
  constructor(
    private readonly workspaces: WorkspaceService,
    private readonly overview: WorkspaceOverviewService,
    private readonly content: WorkspaceContentService,
    private readonly chat: WorkspaceChatService,
  ) {}

  @Get(':slug/messages')
  @ApiOperation({ summary: 'Lịch sử chat của Workspace' })
  messages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Query() query: ListWorkspaceMessagesQueryDto,
  ) {
    return this.chat.history(requireHumanId(user), slug, query);
  }

  @Post(':slug/messages')
  @ApiOperation({ summary: 'Gửi tin nhắn vào Workspace' })
  createMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body() dto: CreateWorkspaceMessageDto,
  ) {
    return this.chat.create(requireHumanId(user), slug, dto);
  }

  @Get(':slug/messages/unread')
  @ApiOperation({ summary: 'Số tin chat chưa đọc' })
  unreadMessages(@CurrentUser() user: AuthenticatedUser, @Param('slug') slug: string) {
    return this.chat.unread(requireHumanId(user), slug);
  }

  @Post(':slug/messages/read')
  @ApiOperation({ summary: 'Đánh dấu chat Workspace đã đọc' })
  markMessagesRead(@CurrentUser() user: AuthenticatedUser, @Param('slug') slug: string) {
    return this.chat.markRead(requireHumanId(user), slug);
  }

  @Patch(':slug/messages/:messageId')
  @ApiOperation({ summary: 'Sửa tin nhắn của chính mình' })
  updateMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('messageId') messageId: string,
    @Body() dto: UpdateWorkspaceMessageDto,
  ) {
    return this.chat.update(requireHumanId(user), slug, messageId, dto);
  }

  @Delete(':slug/messages/:messageId')
  @ApiOperation({ summary: 'Xóa hoặc moderation tin nhắn' })
  deleteMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('messageId') messageId: string,
  ) {
    return this.chat.remove(requireHumanId(user), slug, messageId);
  }

  @Get()
  @ApiOperation({ summary: 'Nhóm học tập của tôi' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListWorkspacesQueryDto) {
    return this.workspaces.list(requireHumanId(user), query);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Thống kê Workspace của tôi' })
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.workspaces.summary(requireHumanId(user));
  }

  @Post()
  @ApiOperation({ summary: 'Tạo nhóm học tập' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateWorkspaceDto) {
    return this.workspaces.create(requireHumanId(user), dto);
  }

  @Post('join')
  @ApiOperation({ summary: 'Tham gia bằng mã mời' })
  join(@CurrentUser() user: AuthenticatedUser, @Body() dto: JoinWorkspaceDto) {
    return this.workspaces.join(requireHumanId(user), dto);
  }

  @Post(':slug/join-request')
  @ApiOperation({ summary: 'Tham gia nhóm mở hoặc gửi yêu cầu tham gia' })
  requestJoin(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body() dto: RequestWorkspaceJoinDto,
  ) {
    return this.workspaces.requestJoin(requireHumanId(user), slug, dto);
  }

  @Get(':slug/overview')
  @ApiOperation({ summary: 'Dashboard dữ liệu thật của nhóm học tập' })
  overviewData(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Query() query: WorkspaceOverviewQueryDto,
  ) {
    return this.overview.get(requireHumanId(user), slug, query);
  }

  @Get(':slug/documents/upload-config')
  documentUploadConfig(@CurrentUser() user: AuthenticatedUser, @Param('slug') slug: string) {
    return this.content.uploadConfig(requireHumanId(user), slug);
  }

  @Post(':slug/documents/upload-url')
  documentUploadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body() dto: DocumentUploadUrlDto,
  ) {
    return this.content.presign(requireHumanId(user), slug, dto);
  }

  @Post(':slug/assets/upload-url')
  workspaceAssetUploadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body() dto: WorkspaceAssetUploadUrlDto,
  ) {
    return this.content.presignAsset(requireHumanId(user), slug, dto);
  }

  @Get(':slug/assets/cover')
  workspaceCoverPreview(@CurrentUser() user: AuthenticatedUser, @Param('slug') slug: string) {
    return this.content.coverPreview(requireHumanId(user), slug);
  }

  @Get(':slug/documents')
  documents(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Query() query: WorkspaceContentQueryDto,
  ) {
    return this.content.documents(requireHumanId(user), slug, query);
  }

  @Get(':slug/documents/pending-count')
  pendingDocumentCount(@CurrentUser() user: AuthenticatedUser, @Param('slug') slug: string) {
    return this.content.pendingDocumentCount(requireHumanId(user), slug);
  }

  @Post(':slug/documents')
  createDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body() dto: CreateWorkspaceDocumentDto,
  ) {
    return this.content.createDocument(requireHumanId(user), slug, dto);
  }

  @Patch(':slug/documents/:documentId')
  updateDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('documentId') id: string,
    @Body() dto: UpdateWorkspaceDocumentDto,
  ) {
    return this.content.updateDocument(requireHumanId(user), slug, id, dto);
  }

  @Delete(':slug/documents/:documentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('documentId') id: string,
    @Body() dto: RemoveWorkspaceContentDto,
  ) {
    await this.content.deleteDocument(requireHumanId(user), slug, id, dto);
  }

  @Post(':slug/documents/:documentId/restore')
  restoreDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('documentId') id: string,
  ) {
    return this.content.restoreDocument(requireHumanId(user), slug, id);
  }

  @Delete(':slug/documents/:documentId/permanent')
  @HttpCode(HttpStatus.NO_CONTENT)
  async purgeDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('documentId') id: string,
  ) {
    await this.content.purgeDocument(requireHumanId(user), slug, id);
  }

  @Post(':slug/documents/:documentId/reports')
  reportDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('documentId') id: string,
    @Body() dto: ReportWorkspaceDocumentDto,
  ) {
    return this.content.reportDocument(requireHumanId(user), slug, id, dto);
  }

  @Get(':slug/documents/:documentId/download')
  documentDownload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('documentId') id: string,
    @Query('preview') preview?: string,
  ) {
    return this.content.documentDownload(
      requireHumanId(user),
      slug,
      id,
      preview === '1' || preview === 'true',
    );
  }

  @Get(':slug/exercises')
  exercises(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Query() query: WorkspaceContentQueryDto,
  ) {
    return this.content.exercises(requireHumanId(user), slug, query);
  }

  @Post(':slug/exercises')
  createExercise(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body() dto: CreateWorkspaceExerciseDto,
  ) {
    return this.content.createExercise(requireHumanId(user), slug, dto);
  }

  @Post(':slug/exercises/generate-draft')
  generateExerciseDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body() dto: GenerateWorkspaceExerciseDraftDto,
  ) {
    return this.content.generateExerciseDraft(requireHumanId(user), slug, dto);
  }

  @Post(':slug/exercises/attach')
  attachExercise(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body() dto: AttachWorkspaceExerciseDto,
  ) {
    return this.content.attachExercise(requireHumanId(user), slug, dto);
  }

  @Post(':slug/exercises/:groupExerciseId/duplicate')
  duplicateExercise(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('groupExerciseId') id: string,
  ) {
    return this.content.duplicateExercise(requireHumanId(user), slug, id);
  }

  @Get(':slug/exercises/:groupExerciseId/detail')
  exerciseDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('groupExerciseId') id: string,
  ) {
    return this.content.exerciseDetail(requireHumanId(user), slug, id);
  }

  @Patch(':slug/exercises/:groupExerciseId')
  updateExercise(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('groupExerciseId') id: string,
    @Body() dto: UpdateWorkspaceExerciseDto,
  ) {
    return this.content.updateExercise(requireHumanId(user), slug, id, dto);
  }

  @Delete(':slug/exercises/:groupExerciseId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteExercise(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('groupExerciseId') id: string,
    @Body() dto: RemoveWorkspaceContentDto,
  ) {
    await this.content.deleteExercise(requireHumanId(user), slug, id, dto);
  }

  @Post(':slug/exercises/:groupExerciseId/restore')
  restoreExercise(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('groupExerciseId') id: string,
  ) {
    return this.content.restoreExercise(requireHumanId(user), slug, id);
  }

  @Delete(':slug/exercises/:groupExerciseId/permanent')
  @HttpCode(HttpStatus.NO_CONTENT)
  async purgeExercise(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('groupExerciseId') id: string,
  ) {
    await this.content.purgeExercise(requireHumanId(user), slug, id);
  }

  @Get(':slug/assignments')
  assignments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Query() query: WorkspaceContentQueryDto,
  ) {
    return this.content.assignments(requireHumanId(user), slug, query);
  }

  @Patch(':slug/assignments/:assignmentId')
  updateAssignment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('assignmentId') id: string,
    @Body() dto: UpdateWorkspaceAssignmentDto,
  ) {
    return this.content.updateAssignment(requireHumanId(user), slug, id, dto);
  }

  @Get(':slug/assignments/:assignmentId/submissions')
  submissionHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('assignmentId') id: string,
  ) {
    return this.content.submissionHistory(requireHumanId(user), slug, id);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Chi tiết nhóm học tập' })
  detail(@CurrentUser() user: AuthenticatedUser, @Param('slug') slug: string) {
    return this.workspaces.detail(requireHumanId(user), slug);
  }

  @Patch(':slug')
  @ApiOperation({ summary: 'Sửa thông tin nhóm' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    return this.workspaces.update(requireHumanId(user), slug, dto);
  }

  @Post(':slug/archive')
  @ApiOperation({ summary: 'Lưu trữ nhóm' })
  archive(@CurrentUser() user: AuthenticatedUser, @Param('slug') slug: string) {
    return this.workspaces.archive(requireHumanId(user), slug);
  }

  @Post(':slug/invite-code/rotate')
  @ApiOperation({ summary: 'Xoay mã mời của nhóm' })
  rotateInviteCode(@CurrentUser() user: AuthenticatedUser, @Param('slug') slug: string) {
    return this.workspaces.rotateInviteCode(requireHumanId(user), slug);
  }

  @Post(':slug/leave')
  @ApiOperation({ summary: 'Rời nhóm' })
  leave(@CurrentUser() user: AuthenticatedUser, @Param('slug') slug: string) {
    return this.workspaces.leave(requireHumanId(user), slug);
  }

  @Get(':slug/members')
  @ApiOperation({ summary: 'Danh sách thành viên' })
  members(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Query() query: ListMembersQueryDto,
  ) {
    return this.workspaces.members(requireHumanId(user), slug, query);
  }

  @Get(':slug/members/:memberId')
  @ApiOperation({ summary: 'Dashboard, hoạt động và quyền hiệu lực của thành viên' })
  memberDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('memberId') memberId: string,
  ) {
    return this.workspaces.memberDetail(requireHumanId(user), slug, memberId);
  }

  @Get(':slug/join-requests')
  @ApiOperation({ summary: 'Danh sách yêu cầu tham gia đang chờ' })
  joinRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Query() query: ListJoinRequestsQueryDto,
  ) {
    return this.workspaces.joinRequests(requireHumanId(user), slug, query.status);
  }

  @Post(':slug/join-requests/:requestId/approve')
  approveJoinRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('requestId') requestId: string,
  ) {
    return this.workspaces.reviewJoinRequest(requireHumanId(user), slug, requestId, 'approved');
  }

  @Post(':slug/join-requests/:requestId/reject')
  rejectJoinRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('requestId') requestId: string,
  ) {
    return this.workspaces.reviewJoinRequest(requireHumanId(user), slug, requestId, 'rejected');
  }

  @Post(':slug/invitations')
  @ApiOperation({ summary: 'Mời người dùng bằng handle' })
  invite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body() dto: InviteWorkspaceMemberDto,
  ) {
    return this.workspaces.invite(requireHumanId(user), slug, dto.handle);
  }

  @Get(':slug/invitations')
  @ApiOperation({ summary: 'Danh sách lời mời đang chờ' })
  invitations(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Query() query: ListMembersQueryDto,
  ) {
    return this.workspaces.invitations(requireHumanId(user), slug, query);
  }

  @Post(':slug/invitations/:invitationId/accept')
  @ApiOperation({ summary: 'Chấp nhận lời mời vào nhóm' })
  acceptInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.workspaces.acceptInvitation(requireHumanId(user), slug, invitationId);
  }

  @Delete(':slug/invitations/:invitationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Thu hồi lời mời' })
  async revokeInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('invitationId') invitationId: string,
  ) {
    await this.workspaces.revokeInvitation(requireHumanId(user), slug, invitationId);
  }

  @Patch(':slug/members/:memberId/role')
  @ApiOperation({ summary: 'Đổi role Phó nhóm/Thành viên' })
  updateMemberRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.workspaces.updateMemberRole(requireHumanId(user), slug, memberId, dto);
  }

  @Delete(':slug/members/:memberId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Loại thành viên khỏi nhóm' })
  async removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('memberId') memberId: string,
  ) {
    await this.workspaces.removeMember(requireHumanId(user), slug, memberId);
  }

  @Post(':slug/transfer-ownership')
  @ApiOperation({ summary: 'Chuyển quyền Chủ nhóm' })
  transferOwnership(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body() dto: TransferOwnershipDto,
  ) {
    return this.workspaces.transferOwnership(requireHumanId(user), slug, dto);
  }

  @Put(':slug/permissions/roles/:role')
  @ApiOperation({ summary: 'Cập nhật quyền mặc định của role' })
  updateRolePermissions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('role') role: 'deputy' | 'member',
    @Body() dto: UpdateRolePermissionsDto,
  ) {
    return this.workspaces.updateRolePermissions(requireHumanId(user), slug, role, dto);
  }

  @Put(':slug/members/:memberId/permissions')
  @ApiOperation({ summary: 'Cập nhật quyền riêng của thành viên' })
  updateMemberPermissions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateMemberPermissionsDto,
  ) {
    return this.workspaces.updateMemberPermissions(requireHumanId(user), slug, memberId, dto);
  }
}

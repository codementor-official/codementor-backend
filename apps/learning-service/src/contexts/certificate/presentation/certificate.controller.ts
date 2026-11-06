import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public, Roles, type AuthenticatedUser } from '@codementor/platform';
import { CertificateUseCases } from '../application/certificate.usecases';
import { AdminCertificatesQueryDto, ClaimCertificateDto, RevokeCertificateDto } from './certificate.dto';

/** Chứng chỉ đã cấp (ADR 0005). Route cụ thể đặt trước `:code`. */
@ApiTags('certificates')
@ApiBearerAuth('access-token')
@Controller({ path: 'certificates', version: '1' })
export class CertificateController {
  constructor(private readonly certificates: CertificateUseCases) {}

  @Get('mine')
  @ApiOperation({ summary: 'Chứng chỉ của tôi, mới cấp trước' })
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.certificates.mine(user);
  }

  @Get('status/:subject/:id')
  @ApiOperation({ summary: 'Trạng thái chứng chỉ của tôi cho một khóa học/lộ trình, kèm bản xem trước' })
  status(
    @CurrentUser() user: AuthenticatedUser,
    @Param('subject') subject: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.certificates.status(user, subject === 'roadmap' ? 'roadmap' : 'course', id);
  }

  @Post()
  @ApiOperation({ summary: 'Nhận chứng chỉ — một lần cho mỗi khóa học/lộ trình' })
  @ApiResponse({ status: 409, description: 'Đã nhận rồi' })
  @ApiResponse({ status: 422, description: 'Chưa hoàn thành' })
  async claim(@CurrentUser() user: AuthenticatedUser, @Body() dto: ClaimCertificateDto) {
    // Bọc trong `{ status, certificate }` (cùng dạng `status/...`), KHÔNG trả thẳng chứng chỉ:
    // chứng chỉ có trường `data`, và response interceptor coi mọi body có khóa `data` là đã
    // bọc sẵn nên bỏ qua — client `unwrap` khi đó nhận nhầm `certificate.data`.
    const certificate = await this.certificates.claim(user, dto.subject, dto.subjectId, dto.recipientName);
    return { status: 'issued' as const, certificate };
  }

  @Get('admin')
  @Roles('admin')
  @ApiOperation({ summary: 'Mọi chứng chỉ đã cấp, kể cả đã thu hồi' })
  adminList(@Query() query: AdminCertificatesQueryDto) {
    return this.certificates.adminList({ q: query.q, page: query.page ?? 1, limit: query.limit ?? 20 });
  }

  @Post(':id/revoke')
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Thu hồi để học viên nhận lại (ví dụ in sai tên)' })
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RevokeCertificateDto,
  ) {
    return this.certificates.revoke(user, id, dto.reason);
  }

  @Get(':code')
  @Public()
  @ApiOperation({ summary: 'Xác thực công khai theo mã' })
  verify(@Param('code') code: string) {
    return this.certificates.verify(code);
  }
}

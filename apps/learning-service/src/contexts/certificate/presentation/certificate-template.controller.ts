import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, type AuthenticatedUser } from '@codementor/platform';
import { CertificateTemplateUseCases } from '../application/certificate-template.usecases';
import {
  AttachCertificateTemplateDto,
  CertificateAssetUploadDto,
  CertificateTemplateDto,
} from './certificate-template.dto';

/** Mẫu chứng chỉ của giảng viên, và mẫu mặc định do admin sửa (ADR 0005). */
@ApiTags('certificates')
@ApiBearerAuth('access-token')
@Controller({ version: '1' })
export class CertificateTemplateController {
  constructor(private readonly templates: CertificateTemplateUseCases) {}

  @Get('certificate-templates')
  @Roles('lecturer')
  @ApiOperation({ summary: 'Mẫu mặc định + mẫu của tôi' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.templates.list(user);
  }

  @Post('certificate-templates')
  @Roles('lecturer')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CertificateTemplateDto) {
    return this.templates.create(user, { name: dto.name, subject: dto.subject ?? null, design: dto.design });
  }

  @Get('certificate-templates/:id')
  @Roles('lecturer')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.templates.get(user, id);
  }

  @Patch('certificate-templates/:id')
  @Roles('lecturer')
  @ApiOperation({ summary: 'Sửa mẫu. Mẫu mặc định: chỉ admin' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CertificateTemplateDto,
  ) {
    return this.templates.update(user, id, { name: dto.name, subject: dto.subject ?? null, design: dto.design });
  }

  @Delete('certificate-templates/:id')
  @Roles('lecturer')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Lưu trữ mẫu; nội dung đang gắn quay về mẫu mặc định' })
  archive(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.templates.archive(user, id);
  }

  @Post('certificate-templates/:id/asset-upload-url')
  @Roles('lecturer')
  @ApiOperation({ summary: 'URL tải trực tiếp logo hoặc chữ ký' })
  assetUploadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CertificateAssetUploadDto,
  ) {
    return this.templates.presignAsset(user, id, dto);
  }

  @Get('courses/:id/certificate-template')
  @Roles('lecturer')
  attachedCourse(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.templates.attached(user, 'course', id);
  }

  @Get('roadmaps/:id/certificate-template')
  @Roles('lecturer')
  attachedRoadmap(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.templates.attached(user, 'roadmap', id);
  }

  @Put('courses/:id/certificate-template')
  @Roles('lecturer')
  @ApiOperation({ summary: 'Gắn mẫu chứng chỉ cho khóa học (null = mẫu mặc định)' })
  attachCourse(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AttachCertificateTemplateDto,
  ) {
    return this.templates.attach(user, 'course', id, dto.templateId);
  }

  @Put('roadmaps/:id/certificate-template')
  @Roles('lecturer')
  @ApiOperation({ summary: 'Gắn mẫu chứng chỉ cho lộ trình (null = mẫu mặc định)' })
  attachRoadmap(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AttachCertificateTemplateDto,
  ) {
    return this.templates.attach(user, 'roadmap', id, dto.templateId);
  }
}

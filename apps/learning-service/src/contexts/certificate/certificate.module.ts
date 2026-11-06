import { Module } from '@nestjs/common';
import { CertificateTemplateUseCases } from './application/certificate-template.usecases';
import { CertificateTemplateStore } from './infrastructure/certificate-template.store';
import { CertificateTemplateController } from './presentation/certificate-template.controller';

/** Chứng chỉ hoàn thành khóa học/lộ trình (ADR 0005). */
@Module({
  controllers: [CertificateTemplateController],
  providers: [CertificateTemplateStore, CertificateTemplateUseCases],
  exports: [CertificateTemplateStore],
})
export class CertificateModule {}

import { Module } from '@nestjs/common';
import { CertificateTemplateUseCases } from './application/certificate-template.usecases';
import { CertificateUseCases } from './application/certificate.usecases';
import { CertificateTemplateStore } from './infrastructure/certificate-template.store';
import { CertificateStore } from './infrastructure/certificate.store';
import { CertificateTemplateController } from './presentation/certificate-template.controller';
import { CertificateController } from './presentation/certificate.controller';

/** Chứng chỉ hoàn thành khóa học/lộ trình (ADR 0005). */
@Module({
  controllers: [CertificateTemplateController, CertificateController],
  providers: [CertificateTemplateStore, CertificateTemplateUseCases, CertificateStore, CertificateUseCases],
  exports: [CertificateTemplateStore],
})
export class CertificateModule {}

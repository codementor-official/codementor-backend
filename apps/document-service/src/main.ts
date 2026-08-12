import { bootstrapService } from '@codementor/platform';
import { AppModule } from './app.module';

void bootstrapService(AppModule, {
  name: 'document-service',
  portEnv: 'PORT_DOCUMENT',
  defaultPort: 3005,
  description: 'Tài liệu nhóm. Sở hữu group_documents (1 bảng).',
});

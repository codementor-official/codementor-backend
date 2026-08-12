import { bootstrapService } from '@codementor/platform';
import { AppModule } from './app.module';

void bootstrapService(AppModule, {
  name: 'submission-service',
  portEnv: 'PORT_SUBMISSION',
  defaultPort: 3006,
  description: 'Bài nộp. Sở hữu submissions (1 bảng). Dùng outbox để không mất lệnh chấm.',
});

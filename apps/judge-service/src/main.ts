import { bootstrapService } from '@codementor/platform';
import { AppModule } from './app.module';

void bootstrapService(AppModule, {
  name: 'judge-service',
  portEnv: 'PORT_JUDGE',
  defaultPort: 3007,
  description: 'Chạy và chấm code trong sandbox. KHÔNG sở hữu bảng nào.',
  internal: true,
});

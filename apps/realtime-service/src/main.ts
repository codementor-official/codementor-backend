import { bootstrapService } from '@codementor/platform';
import { AppModule } from './app.module';

void bootstrapService(AppModule, {
  name: 'realtime-service',
  portEnv: 'PORT_REALTIME',
  defaultPort: 3009,
  description: 'Cầu nối Kafka -> WebSocket/SSE. KHÔNG sở hữu bảng nào, KHÔNG có business logic.',
});

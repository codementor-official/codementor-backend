import { bootstrapService } from '@codementor/platform';
import { AppModule } from './app.module';

void bootstrapService(AppModule, {
  name: 'ai-service',
  portEnv: 'PORT_AI',
  defaultPort: 3008,
  description: 'Tích hợp AI: hỏi đáp, phân tích lỗi, tiền kiểm tài liệu, sinh bài tập. KHÔNG sở hữu bảng PostgreSQL.',
  internal: true,
});

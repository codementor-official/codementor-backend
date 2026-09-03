import { bootstrapService } from '@codementor/platform';
import { AppModule } from './app.module';

void bootstrapService(AppModule, {
  name: 'recommendation-service',
  portEnv: 'PORT_RECOMMENDATION',
  // 3010/3011 là apps/lecturer và apps/admin bên frontend, 3012 là notification.
  defaultPort: 3013,
  description:
    'Đề xuất lộ trình / khóa học / bài tập: luật theo hồ sơ khai + content-based (TF-IDF/cosine) theo lịch sử đã có. Không sở hữu bảng nào, không thu thập hành vi mới.',
});

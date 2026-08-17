import { bootstrapService } from '@codementor/platform';
import { AppModule } from './app.module';

void bootstrapService(AppModule, {
  name: 'notification-service',
  portEnv: 'PORT_NOTIFICATION',
  // 3010 và 3011 đã thuộc về apps/lecturer và apps/admin bên frontend, cùng chạy trên
  // localhost lúc dev — nên dải backend nhảy qua chúng.
  defaultPort: 3012,
  description: 'Thông báo hệ thống: Kafka -> MongoDB -> evt.notification.created.v1.',
});

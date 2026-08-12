import { bootstrapService } from '@codementor/platform';
import { AppModule } from './app.module';

void bootstrapService(AppModule, {
  name: 'workspace-service',
  portEnv: 'PORT_WORKSPACE',
  defaultPort: 3004,
  description: 'Nhóm học tập. Sở hữu study_groups, group_members, permissions, assignments (7 bảng).',
});

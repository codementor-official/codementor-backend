import { bootstrapService } from '@codementor/platform';
import { AppModule } from './app.module';

void bootstrapService(AppModule, {
  name: 'exercise-service',
  portEnv: 'PORT_EXERCISE',
  defaultPort: 3003,
  description: 'Exercise. Sở hữu exercises, exercise_sets, prerequisites, exercise_progress (9 bảng).',
});

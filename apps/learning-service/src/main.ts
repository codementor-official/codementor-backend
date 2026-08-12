import { bootstrapService } from '@codementor/platform';
import { AppModule } from './app.module';

void bootstrapService(AppModule, {
  name: 'learning-service',
  portEnv: 'PORT_LEARNING',
  defaultPort: 3002,
  description: 'Learning + Articles. Sở hữu roadmaps, courses, chapters, lessons, dependency graph, enrollment, progress (19 bảng).',
});

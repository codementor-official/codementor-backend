import { bootstrapService } from '@codementor/platform';
import { AppModule } from './app.module';

void bootstrapService(AppModule, {
  name: 'core-service',
  portEnv: 'PORT_CORE',
  defaultPort: 3001,
  description: 'Identity (Keycloak-backed) + Catalog. Sở hữu users, preferences, technologies, tags, companies.',
});

import { ValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

export interface BootstrapOptions {
  /** Tên service, hiện trong log và tiêu đề Swagger. */
  name: string;
  /** Biến env chứa cổng lắng nghe, vd PORT_CORE. */
  portEnv: string;
  defaultPort: number;
  description?: string;
  /** Service nội bộ (judge, ai) không expose Swagger ra ngoài. */
  internal?: boolean;
}

/**
 * Bootstrap dùng chung cho cả 9 service.
 *
 * Gom vào đây để mọi service có cùng hành vi validation, versioning, xử lý lỗi và
 * shutdown — thay vì 9 bản main.ts copy-paste rồi trôi dạt khỏi nhau.
 */
export async function bootstrapService(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  appModule: any,
  options: BootstrapOptions,
): Promise<INestApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    appModule,
    new FastifyAdapter({ trustProxy: true, genReqId: () => randomUUID() }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));
  const config = app.get(ConfigService);
  const port = Number(config.get(options.portEnv, options.defaultPort));

  await app.register(import('@fastify/helmet'), { contentSecurityPolicy: false });
  app.enableCors({
    origin: config.get<string[]>('CORS_ORIGINS', ['http://localhost:3000']),
    credentials: true,
  });

  app.setGlobalPrefix(config.get<string>('API_PREFIX', 'api'));
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.enableShutdownHooks();

  if (!options.internal && config.get('SWAGGER_ENABLED', true)) {
    const doc = new DocumentBuilder()
      .setTitle(`CodeMentor — ${options.name}`)
      .setDescription(options.description ?? '')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
      .build();
    SwaggerModule.setup(
      `${config.get<string>('API_PREFIX', 'api')}/docs`,
      app,
      SwaggerModule.createDocument(app, doc),
      { swaggerOptions: { persistAuthorization: true } },
    );
  }

  await app.listen({ port, host: '0.0.0.0' });
  return app;
}

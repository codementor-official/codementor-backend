import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isDev = config.get<string>('NODE_ENV') !== 'production';
        return {
          pinoHttp: {
            level: config.get<string>('LOG_LEVEL', 'info'),
            genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
            // Không bao giờ log token hay mật khẩu.
            redact: {
              paths: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password'],
              censor: '[đã ẩn]',
            },
            transport: isDev
              ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } }
              : undefined,
          },
        };
      },
    }),
  ],
  exports: [LoggerModule],
})
export class LoggingModule {}

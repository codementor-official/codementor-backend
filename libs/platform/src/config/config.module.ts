import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule, ConfigService } from '@nestjs/config';
import { validateEnv, type Env } from './env.schema';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      envFilePath: ['.env.local', '.env'],
    }),
  ],
  providers: [
    {
      // Truy cập env đã typed, không phải string tuỳ ý.
      provide: 'ENV',
      inject: [ConfigService],
      useFactory: (config: ConfigService): Env => config as unknown as Env,
    },
  ],
  exports: ['ENV'],
})
export class ConfigModule {}

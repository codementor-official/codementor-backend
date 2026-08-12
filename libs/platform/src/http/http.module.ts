import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { DomainExceptionFilter } from './filters/domain-exception.filter';
import { ResponseInterceptor } from './interceptors/response.interceptor';

@Module({
  providers: [
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class HttpModule {}

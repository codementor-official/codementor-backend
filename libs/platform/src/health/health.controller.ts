import { Controller, Get, Optional } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { PrismaService } from '../database/prisma/prisma.service';
import { Public } from '../auth/public.decorator';

@ApiTags('health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  /**
   * Cả hai đều Optional: không phải service nào cũng dùng cả hai database
   * (realtime không đụng Postgres, judge không đụng Mongo). Bắt buộc thì
   * HealthModule sẽ làm chết boot của đúng những service nhẹ nhất.
   * Chỉ dependency thực sự được nối mới xuất hiện trong kết quả.
   */
  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() @InjectConnection() private readonly mongo?: Connection,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Kiểm tra các database mà service này thực sự dùng' })
  async check() {
    const dependencies: Record<string, boolean> = {};
    if (this.prisma) dependencies.postgres = await this.pingPostgres(this.prisma);
    if (this.mongo) dependencies.mongodb = this.mongo.readyState === 1;

    return {
      status: Object.values(dependencies).every(Boolean) ? 'ok' : 'degraded',
      dependencies,
      timestamp: new Date().toISOString(),
    };
  }

  private async pingPostgres(prisma: PrismaService): Promise<boolean> {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}

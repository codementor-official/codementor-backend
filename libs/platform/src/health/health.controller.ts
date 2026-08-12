import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { PrismaService } from '../database/prisma/prisma.service';
import { Public } from '../auth/public.decorator';

@ApiTags('health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectConnection() private readonly mongo: Connection,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Kiểm tra kết nối hai database' })
  async check() {
    const [postgres, mongodb] = await Promise.all([this.pingPostgres(), this.pingMongo()]);
    return {
      status: postgres && mongodb ? 'ok' : 'degraded',
      dependencies: { postgres, mongodb },
      timestamp: new Date().toISOString(),
    };
  }

  private async pingPostgres(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  private async pingMongo(): Promise<boolean> {
    return this.mongo.readyState === 1;
  }
}

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Kết nối PostgreSQL.
 *
 * QUAN TRỌNG: repo này KHÔNG sở hữu schema. Migration nằm ở
 * codementor-infra/database/postgres/migrations. Ở đây chỉ introspect (`prisma db pull`)
 * rồi generate client. Chạy `prisma migrate` sẽ XOÁ 28 trigger và 5 hàm PL/pgSQL đang
 * giữ các bất biến (chống chu trình phụ thuộc, cache tiến độ).
 * Xem docs/00-architecture-review.md §5.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('PostgreSQL đã kết nối');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

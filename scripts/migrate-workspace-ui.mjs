import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  const statements = [
    "ALTER TABLE study_groups ADD COLUMN IF NOT EXISTS cover_position text NOT NULL DEFAULT 'center'",
    "ALTER TABLE study_groups ADD COLUMN IF NOT EXISTS cover_fit text NOT NULL DEFAULT 'cover'",
    "ALTER TABLE study_groups ADD COLUMN IF NOT EXISTS cover_height text NOT NULL DEFAULT 'medium'",
  ];
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);
  console.log('Workspace UI schema is up to date.');
} finally {
  await prisma.$disconnect();
}

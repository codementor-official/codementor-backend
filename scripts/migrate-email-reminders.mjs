import { PrismaClient } from '@prisma/client';
import { readFile } from 'node:fs/promises';
const prisma = new PrismaClient();
try {
  const files = process.argv[2] ? [process.argv[2]] : [
    '../codementor-infra/database/postgres/migrations/0026_email_reminders.sql',
    '../codementor-infra/database/postgres/migrations/0027_personal_study_reminders.sql',
    '../codementor-infra/database/postgres/migrations/0028_workspace_notification_events.sql',
  ];
  const sql = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n-- statement-breakpoint\n');
  await prisma.$transaction(async (tx) => {
    for (const statement of sql.split('-- statement-breakpoint')) {
      if (statement.trim()) await tx.$executeRawUnsafe(statement);
    }
  }, { timeout: 60000 });
  console.log('Email reminder schema ready (idempotent; existing users/data preserved).');
} finally { await prisma.$disconnect(); }

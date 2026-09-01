import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE articles ADD COLUMN IF NOT EXISTS cover_image_url text`,
  );
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS user_bookmarks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type varchar(20) NOT NULL,
      target_id uuid NOT NULL,
      target_ref varchar(240),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_user_bookmarks_target_type
        CHECK (target_type IN ('COURSE', 'ROADMAP', 'EXERCISE', 'POST')),
      CONSTRAINT uq_user_bookmarks_target UNIQUE (user_id, target_type, target_id)
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_user_bookmarks_user_created
      ON user_bookmarks (user_id, created_at DESC)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS content_reports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type varchar(20) NOT NULL,
      target_id uuid NOT NULL,
      target_ref varchar(240),
      category varchar(30) NOT NULL,
      note varchar(1000),
      status varchar(20) NOT NULL DEFAULT 'PENDING',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_content_reports_target_type
        CHECK (target_type IN ('DOCUMENT', 'POST', 'COURSE', 'ROADMAP', 'EXERCISE', 'WORKSPACE')),
      CONSTRAINT ck_content_reports_category
        CHECK (category IN ('SPAM', 'MISLEADING', 'INAPPROPRIATE', 'COPYRIGHT', 'OTHER')),
      CONSTRAINT ck_content_reports_status
        CHECK (status IN ('PENDING', 'RESOLVED', 'REJECTED')),
      CONSTRAINT uq_content_reports_reporter_target UNIQUE (reporter_id, target_type, target_id)
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_content_reports_status_created
      ON content_reports (status, created_at DESC)
  `);
  await prisma.$executeRawUnsafe(
    `ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS resolution_note varchar(1000)`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS resolved_by uuid`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS resolved_at timestamptz`,
  );
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS assignment_reminder_deliveries (
      assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      kind varchar(20) NOT NULL,
      sent_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_assignment_reminder_kind CHECK (kind IN ('due_soon', 'overdue')),
      CONSTRAINT pk_assignment_reminder_deliveries PRIMARY KEY (assignment_id, kind)
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_assignment_reminder_deliveries_sent
      ON assignment_reminder_deliveries (sent_at DESC)
  `);
  console.log('client support schema is ready');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

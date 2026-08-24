import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const permissions = [
  'view_doc',
  'edit_own_doc',
  'delete_own_doc',
  'manage_doc',
  'approve_doc',
  'view_exercise',
  'edit_own_exercise',
  'delete_own_exercise',
  'manage_exercise',
  'assign_exercise',
];

try {
  for (const permission of permissions) {
    await prisma.$executeRawUnsafe(
      `ALTER TYPE group_permission ADD VALUE IF NOT EXISTS '${permission}'`,
    );
  }
  const statements = [
    'ALTER TABLE group_documents ADD COLUMN IF NOT EXISTS deleted_at timestamptz',
    'ALTER TABLE group_documents ADD COLUMN IF NOT EXISTS deleted_by uuid',
    'ALTER TABLE group_documents ADD COLUMN IF NOT EXISTS delete_reason text',
    "ALTER TABLE group_exercises ADD COLUMN IF NOT EXISTS publication_status text NOT NULL DEFAULT 'published'",
    'ALTER TABLE group_exercises ADD COLUMN IF NOT EXISTS deleted_at timestamptz',
    'ALTER TABLE group_exercises ADD COLUMN IF NOT EXISTS deleted_by uuid',
    'ALTER TABLE group_exercises ADD COLUMN IF NOT EXISTS delete_reason text',
    `CREATE TABLE IF NOT EXISTS workspace_document_reports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id uuid NOT NULL REFERENCES study_groups(id) ON DELETE CASCADE,
      document_id uuid NOT NULL REFERENCES group_documents(id) ON DELETE CASCADE,
      reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category text NOT NULL,
      note text,
      status text NOT NULL DEFAULT 'PENDING',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT workspace_document_reports_reporter_id_document_id_key UNIQUE (reporter_id, document_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_workspace_document_reports_queue
      ON workspace_document_reports(group_id, status, created_at DESC)`,
  ];
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);
  console.log('Workspace content schema is up to date.');
} finally {
  await prisma.$disconnect();
}

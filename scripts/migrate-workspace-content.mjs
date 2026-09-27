import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const permissions = [
  'view_doc',
  'edit_own_doc',
  'delete_own_doc',
  'edit_doc',
  'approve_doc',
  'view_exercise',
  'edit_own_exercise',
  'delete_own_exercise',
  'delete_exercise',
  'assign_exercise',
];

try {
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'group_permission' AND e.enumlabel = 'manage_doc'
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'group_permission' AND e.enumlabel = 'edit_doc'
      ) THEN
        EXECUTE 'ALTER TYPE group_permission RENAME VALUE ''manage_doc'' TO ''edit_doc''';
      END IF;
      IF EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'group_permission' AND e.enumlabel = 'manage_exercise'
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'group_permission' AND e.enumlabel = 'delete_exercise'
      ) THEN
        EXECUTE 'ALTER TYPE group_permission RENAME VALUE ''manage_exercise'' TO ''delete_exercise''';
      END IF;
    END
    $$;
  `);
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
    // workspace_document_reports đã bỏ — báo cáo tài liệu ghi vào content_reports (infra 0030).
  ];
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);
  console.log('Workspace content schema is up to date.');
} finally {
  await prisma.$disconnect();
}

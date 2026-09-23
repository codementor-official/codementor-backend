import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
try {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS exercise_solutions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    exercise_id uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title varchar(160) NOT NULL,
    explanation text NOT NULL,
    code text,
    language varchar(40),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT exercise_solutions_title_length CHECK (char_length(trim(title)) BETWEEN 3 AND 160),
    CONSTRAINT exercise_solutions_explanation_length CHECK (char_length(trim(explanation)) BETWEEN 10 AND 20000),
    CONSTRAINT exercise_solutions_code_length CHECK (code IS NULL OR char_length(code) <= 30000)
  )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS exercise_solutions_exercise_created ON exercise_solutions(exercise_id, created_at DESC) WHERE deleted_at IS NULL`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS exercise_solution_comments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    solution_id uuid NOT NULL REFERENCES exercise_solutions(id) ON DELETE CASCADE,
    author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT exercise_solution_comments_body_length CHECK (char_length(trim(body)) BETWEEN 1 AND 5000)
  )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS exercise_solution_comments_solution_created ON exercise_solution_comments(solution_id, created_at ASC) WHERE deleted_at IS NULL`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS exercise_solution_votes (
    solution_id uuid NOT NULL REFERENCES exercise_solutions(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (solution_id, user_id)
  )`);
  console.log('Exercise solutions, comments and votes ready');
} finally {
  await prisma.$disconnect();
}

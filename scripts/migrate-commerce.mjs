import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const raw = process.env.DATABASE_URL;
if (!raw) throw new Error('DATABASE_URL is required; credentials are never printed');
if (process.env.NODE_ENV === 'production')
  throw new Error('This migration runner is for local/sandbox only');
const target = new URL(raw);
if (
  !['localhost', '127.0.0.1', '::1'].includes(target.hostname) &&
  !process.argv.includes('--allow-remote-sandbox')
)
  throw new Error(
    'Remote target blocked. Review target and explicitly pass --allow-remote-sandbox for an authorized test database only.',
  );
const migrations = [
  ['0032_course_commerce.sql', 'commerce_policy'],
  ['0033_commerce_recipient_details.sql', null],
  ['0034_course_promotions.sql', 'course_promotions'],
  ['0035_course_promotion_approval.sql', 'course_promotion_requests'],
  ['0036_course_price_review.sql', null],
  ['0037_commerce_consistency.sql', 'commerce_reconciliation_issues'],
  ['0038_vnpay_query_throttle.sql', 'commerce_provider_query_leases'],
].map(([name, guard]) => ({
  guard,
  file: fileURLToPath(new URL(`../../codementor-infra/database/postgres/migrations/${name}`, import.meta.url)),
}));
const env = {
  ...process.env,
  PGHOST: target.hostname,
  PGPORT: target.port || '5432',
  PGUSER: decodeURIComponent(target.username),
  PGPASSWORD: decodeURIComponent(target.password),
  PGDATABASE: decodeURIComponent(target.pathname.slice(1)),
  PGSSLMODE: target.searchParams.get('sslmode') ?? 'prefer',
};
delete env.DATABASE_URL;
for (const { file, guard } of migrations) {
  if (guard) {
    const exists = spawnSync(
      'psql',
      ['--no-psqlrc', '--tuples-only', '--no-align', '--command', `SELECT to_regclass('public.${guard}') IS NOT NULL`],
      { env, encoding: 'utf8', windowsHide: true },
    );
    if (exists.error)
      throw new Error('psql could not start. Install PostgreSQL client tools and add psql to PATH.');
    if (exists.status !== 0) {
      process.exitCode = exists.status ?? 1;
      break;
    }
    if (exists.stdout.trim() === 't') continue;
  }
  const result = spawnSync('psql', ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--file', file], {
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error)
    throw new Error('psql could not start. Install PostgreSQL client tools and add psql to PATH.');
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}

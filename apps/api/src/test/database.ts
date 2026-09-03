import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * A real Postgres, never a stand-in.
 *
 * The queries under test are Drizzle against Postgres 17 with `jsonb`, enums and
 * cascading foreign keys; SQLite or a mocked query builder would prove that the
 * code compiles and nothing else. Each vitest worker gets its own database so
 * files can run in parallel without sharing rows, and each run drops and
 * recreates it so a crashed run cannot leave state behind.
 */
const MIGRATIONS = fileURLToPath(new URL('../../../../packages/db/drizzle', import.meta.url));

export const DATABASE_AVAILABLE = Boolean(process.env.DATABASE_URL);

/**
 * Refuses to skip in CI. A database-backed suite that quietly passes because
 * nobody started Postgres is worse than one that fails.
 */
export function requireDatabase(): void {
  if (DATABASE_AVAILABLE) return;
  if (!process.env.CI) return;

  throw new Error(
    'DATABASE_URL is not set and CI is: the database-backed suites cannot be skipped',
  );
}

function withDatabaseName(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;

  return parsed.toString();
}

/**
 * Creates a migrated, empty database for this worker and returns its URL. The
 * caller passes it to `buildApp({ databaseUrl })`.
 */
export async function createTestDatabase(): Promise<string> {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is not set');

  const worker = process.env.VITEST_WORKER_ID ?? '1';
  const name = `powerbia_test_${worker}`;

  // `postgres` is the maintenance database: a session cannot drop the database it is in.
  // Notices are silenced: "database does not exist, skipping" is the expected path.
  const admin = postgres(withDatabaseName(base, 'postgres'), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists "${name}" with (force)`);
    await admin.unsafe(`create database "${name}"`);
  } finally {
    await admin.end();
  }

  const url = withDatabaseName(base, name);
  const client = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
  } finally {
    await client.end();
  }

  return url;
}

import { createHash, randomBytes } from 'node:crypto';
import type { User } from '@powerbia/contracts';
import { type Database, schema } from '@powerbia/db';
import { and, eq, gt, lt } from 'drizzle-orm';

export const SESSION_COOKIE = 'powerbia_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(db: Database, userId: string) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TTL_MS);

  await db.insert(schema.sessions).values({ tokenHash: hashToken(token), userId, expiresAt });

  return { token, expiresAt };
}

export async function findSessionUser(db: Database, token: string): Promise<User | null> {
  const rows = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      role: schema.users.role,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(
      and(
        eq(schema.sessions.tokenHash, hashToken(token)),
        gt(schema.sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function deleteSession(db: Database, token: string): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, hashToken(token)));
}

export async function deleteExpiredSessions(db: Database): Promise<void> {
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));
}

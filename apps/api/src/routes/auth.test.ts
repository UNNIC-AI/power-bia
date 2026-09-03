import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../app.js';
import type { DaxExecutor } from '../dax/executor.js';
import { createTestDatabase, DATABASE_AVAILABLE, requireDatabase } from '../test/database.js';

requireDatabase();

/** Nothing in these tests should reach Power BI; `/readyz` is the only caller. */
const executor: DaxExecutor = {
  async execute() {
    return { ok: false, error: 'not available in tests' };
  },
  async health() {
    return false;
  },
};

const ADMIN = {
  email: 'admin@unnic.ai',
  password: 'a-password-long-enough',
  displayName: 'Admin',
};

/** The value of `Set-Cookie` reduced to what a browser would send back. */
function sessionCookie(headers: Record<string, unknown>): string {
  const raw = headers['set-cookie'];
  const values = Array.isArray(raw) ? raw : [raw];
  const cookie = values.find((value): value is string => typeof value === 'string');
  if (!cookie) throw new Error('no session cookie was set');

  return cookie.split(';')[0] as string;
}

describe.skipIf(!DATABASE_AVAILABLE)('auth routes', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildApp({
      databaseUrl: await createTestDatabase(),
      executor,
      bootstrap: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports that an empty instance needs its first admin', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/setup' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ needsSetup: true });
  });

  it('rejects a registration whose body does not match the schema', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { ...ADMIN, email: 'not-an-email' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('makes the first account an admin and opens a session', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: ADMIN,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ email: ADMIN.email, role: 'admin' });
    expect(sessionCookie(response.headers)).toContain('powerbia_session=');
  });

  it('closes registration once an account exists', async () => {
    const setup = await app.inject({ method: 'GET', url: '/api/auth/setup' });
    expect(setup.json()).toEqual({ needsSetup: false });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { ...ADMIN, email: 'second@unnic.ai' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('refuses a wrong password without saying which half was wrong', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ADMIN.email, password: 'not-the-password' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().message).toBe('Invalid email or password');
  });

  it('rejects an unauthenticated request for the current user', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/me' });

    expect(response.statusCode).toBe(401);
  });

  it('accepts the right password and answers /me with that session', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ADMIN.email, password: ADMIN.password },
    });
    expect(login.statusCode).toBe(200);

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: sessionCookie(login.headers) },
    });

    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email: ADMIN.email, role: 'admin' });
  });

  it('logs out and invalidates the cookie it was given', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ADMIN.email, password: ADMIN.password },
    });
    const cookie = sessionCookie(login.headers);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(200);

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });
});

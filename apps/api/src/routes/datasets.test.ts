import { encryptSecret, schema } from '@powerbia/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../app.js';
import type { DaxExecutor } from '../dax/executor.js';
import { createTestDatabase, DATABASE_AVAILABLE, requireDatabase } from '../test/database.js';

requireDatabase();

const executor: DaxExecutor = {
  async execute() {
    return { ok: false, error: 'not available in tests' };
  },
  async health() {
    return false;
  },
};

function sessionCookie(headers: Record<string, unknown>): string {
  const raw = headers['set-cookie'];
  const values = Array.isArray(raw) ? raw : [raw];
  const cookie = values.find((value): value is string => typeof value === 'string');
  if (!cookie) throw new Error('no session cookie was set');

  return cookie.split(';')[0] as string;
}

/**
 * The model is singular and the environment names it. These paths carry no id
 * precisely so a client cannot ask for a different one.
 */
describe.skipIf(!DATABASE_AVAILABLE)('the single model', () => {
  let app: App;
  let cookie: string;

  beforeAll(async () => {
    app = await buildApp({
      databaseUrl: await createTestDatabase(),
      executor,
      bootstrap: false,
    });
    await app.ready();

    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'admin@unnic.ai', password: 'a-password-long-enough', displayName: 'A' },
    });
    cookie = sessionCookie(registered.headers);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an unauthenticated read', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/dataset' });

    expect(response.statusCode).toBe(401);
  });

  it('answers 404 while no model is configured', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/dataset', headers: { cookie } });

    expect(response.statusCode).toBe(404);
  });

  it('serves the row the environment points at, with no id in the path', async () => {
    await app.db.insert(schema.datasets).values({
      name: 'Iowa Liquor Sales',
      tenantId: 'tenant',
      clientId: 'client',
      clientSecretEncrypted: encryptSecret('secret', '0'.repeat(64)),
      workspaceName: 'Analytics',
      datasetName: 'Iowa',
      dateMin: '2012-01-01',
      dateMax: '2021-12-31',
    });

    const response = await app.inject({ method: 'GET', url: '/api/dataset', headers: { cookie } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      name: 'Iowa Liquor Sales',
      source: { workspaceName: 'Analytics', datasetName: 'Iowa' },
      dateRange: { min: '2012-01-01', max: '2021-12-31' },
    });
  });

  it('has no route that lists, creates or deletes a model', async () => {
    const listed = await app.inject({ method: 'GET', url: '/api/datasets', headers: { cookie } });
    expect(listed.statusCode).toBe(404);

    const created = await app.inject({
      method: 'POST',
      url: '/api/dataset',
      headers: { cookie },
      payload: { name: 'another' },
    });
    expect(created.statusCode).toBe(404);
  });

  it('rejects a settings body that does not match the schema', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/dataset',
      headers: { cookie },
      payload: { extraContext: 'x'.repeat(8_001) },
    });

    expect(response.statusCode).toBe(400);
  });
});

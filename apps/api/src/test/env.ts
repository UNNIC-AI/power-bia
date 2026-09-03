/**
 * Fills the environment before anything imports `env.ts`, which parses it at
 * module load and throws on a gap.
 *
 * The values are shaped, not real: no test reaches OpenAI or Power BI, and the
 * tests that touch the database bring their own URL. `DATABASE_URL` is the one
 * variable a run genuinely needs from outside - see `database.ts`.
 */
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  WEB_ORIGIN: 'http://localhost:5173',
  OPENAI_API_KEY: 'test-key',
  DAX_GATEWAY_URL: 'http://localhost:8080',
  DAX_GATEWAY_TOKEN: 'test-token',
  DATASET_SECRET_KEY: '0'.repeat(64),
  SESSION_COOKIE_SECRET: 'test-session-secret-at-least-32-chars',
  INTROSPECT_ON_STARTUP: 'false',
  // Without a source, provisioning reports "unconfigured" and writes nothing.
  PBI_TENANT_ID: '',
  PBI_CLIENT_ID: '',
  PBI_CLIENT_SECRET: '',
  PBI_WORKSPACE_NAME: '',
  PBI_DATASET_NAME: '',
};

for (const [key, value] of Object.entries(defaults)) {
  process.env[key] ??= value;
}

// The schema requires it, and `createTestDatabase` replaces it per worker anyway.
process.env.DATABASE_URL ??= 'postgres://powerbia:powerbia@localhost:5432/powerbia';

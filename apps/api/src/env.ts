import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1),

  OPENAI_API_KEY: z.string().min(1),
  // Any OpenAI-compatible endpoint; defaults to OpenAI itself.
  OPENAI_BASE_URL: z.url().default('https://api.openai.com/v1'),
  LLM_MODEL: z.string().default('gpt-4.1'),

  DAX_GATEWAY_URL: z.url(),
  DAX_GATEWAY_TOKEN: z.string().min(1),

  /*
   * The Power BI source. The environment is its ONLY authority: on boot the API
   * writes these into the dataset row, so changing them and restarting switches
   * the app to a different model. Optional as a group so demo mode - which has
   * no capacity to talk to - still boots; `powerBiSource()` in
   * datasets/provision.ts is what decides whether they are usable.
   */
  PBI_TENANT_ID: z.string().default(''),
  PBI_CLIENT_ID: z.string().default(''),
  PBI_CLIENT_SECRET: z.string().default(''),
  PBI_WORKSPACE_NAME: z.string().default(''),
  PBI_DATASET_NAME: z.string().default(''),
  /** Display name for the model. Defaults to PBI_DATASET_NAME. */
  PBI_MODEL_NAME: z.string().default(''),

  DATASET_SECRET_KEY: z.string().length(64),
  SESSION_COOKIE_SECRET: z.string().min(32),

  /*
   * Startup only refreshes a catalogue that is missing or stale, and never
   * blocks `listen`: the API has to come up and serve even when Power BI or the
   * gateway is down.
   */
  INTROSPECT_ON_STARTUP: z.stringbool().default(true),
  INTROSPECT_MAX_AGE_HOURS: z.coerce.number().int().positive().default(168),

  /**
   * Language the LLM writes the model's own context in, and the fallback for the
   * boot-time generation, which has no user to take a locale from.
   */
  MODEL_CONTEXT_LOCALE: z.enum(['es', 'en']).default('es'),
});

export const env = envSchema.parse(process.env);

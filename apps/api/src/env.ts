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

  DATASET_SECRET_KEY: z.string().length(64),
  SESSION_COOKIE_SECRET: z.string().min(32),

  /*
   * Startup only refreshes a catalogue that is missing or stale, and never
   * blocks `listen`: the API has to come up and serve even when Power BI or the
   * gateway is down.
   */
  INTROSPECT_ON_STARTUP: z.stringbool().default(true),
  INTROSPECT_MAX_AGE_HOURS: z.coerce.number().int().positive().default(168),
});

export const env = envSchema.parse(process.env);

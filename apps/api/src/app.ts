import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import underPressure from '@fastify/under-pressure';
import type { User } from '@powerbia/contracts';
import { createDatabase, type Database } from '@powerbia/db';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyError, type FastifyRequest } from 'fastify';
import {
  createJsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { findSessionUser, SESSION_COOKIE } from './auth/sessions.js';
import { isCatalogueStale } from './datasets/introspect.js';
import {
  findActiveDataset,
  findOrphanedDatasets,
  provisionDatasetFromEnv,
} from './datasets/provision.js';
import { syncDataset } from './datasets/sync.js';
import { createGatewayExecutor, type DaxExecutor } from './dax/executor.js';
import { env } from './env.js';
import { authRoutes } from './routes/auth.js';
import { chatRoutes } from './routes/chat.js';
import { conversationRoutes } from './routes/conversations.js';
import { dashboardRoutes } from './routes/dashboards.js';
import { datasetRoutes } from './routes/datasets.js';
import { userRoutes } from './routes/users.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    executor: DaxExecutor;
  }
  interface FastifyRequest {
    user: User | null;
  }
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function requireUser(request: FastifyRequest): User {
  if (!request.user) throw request.server.httpErrors.unauthorized('Authentication required');

  return request.user;
}

/** Introspection and dataset settings hit the customer's capacity, so they are gated. */
export function requireAdmin(request: FastifyRequest): User {
  const user = requireUser(request);
  if (user.role !== 'admin') throw request.server.httpErrors.forbidden('Admin only');

  return user;
}

export interface BuildAppOptions {
  /** Overridden by the tests, which point at a throwaway schema. */
  databaseUrl?: string;
  /** The tests substitute a stub so no request ever reaches Power BI. */
  executor?: DaxExecutor;
  /**
   * Provisioning and catalogue refresh on `onReady`. Off in tests: they own the
   * contents of their database and must not race a background writer.
   */
  bootstrap?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const { databaseUrl = env.DATABASE_URL, bootstrap = true } = options;

  const app = Fastify({
    logger: {
      /*
       * Session cookies and bearer tokens are credentials: a log line carrying
       * one is as good as the credential itself to anyone who can read the log.
       */
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          'headers.authorization',
          'headers.cookie',
        ],
        censor: '[redacted]',
      },
      ...(env.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty' }, level: 'debug' }
        : { level: env.NODE_ENV === 'test' ? 'silent' : 'info' }),
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('db', createDatabase(databaseUrl));
  app.decorate(
    'executor',
    options.executor ?? createGatewayExecutor(env.DAX_GATEWAY_URL, env.DAX_GATEWAY_TOKEN),
  );
  app.decorateRequest('user', null);

  await app.register(sensible);
  await app.register(helmet);
  await app.register(cookie, { secret: env.SESSION_COOKIE_SECRET });
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

  /*
   * Event-loop backpressure. A question costs eight model calls and a DAX
   * round trip, so a burst can queue far more work than the process can serve;
   * a fast 503 is a better answer than a request that times out at the browser.
   */
  await app.register(underPressure, { maxEventLoopDelay: 1_000, retryAfter: 30 });

  /*
   * The route schemas are already written, so the OpenAPI document is free.
   * Served as JSON only: a rendered reference is a development convenience and
   * is reached through the web app's proxy, not published from production.
   */
  await app.register(swagger, {
    openapi: {
      info: { title: 'Power BIA API', version: '0.1.0' },
      servers: [{ url: '/api' }],
    },
    transform: createJsonSchemaTransform({ skipList: ['/healthz', '/readyz'] }),
  });

  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) request.user = await findSessionUser(app.db, token);
  });

  /**
   * Origin check on mutations. Together with the SameSite=Strict session cookie
   * this covers CSRF without a separate token round trip.
   */
  app.addHook('onRequest', async (request, reply) => {
    if (!UNSAFE_METHODS.has(request.method)) return;

    const origin = request.headers.origin;
    if (origin && origin !== env.WEB_ORIGIN) {
      await reply.code(403).send({ message: 'Cross-origin request rejected' });
    }
  });

  /**
   * One place where an error becomes a response.
   *
   * A client is told the status and a stable message; the stack, the SQL and the
   * provider's own wording stay in the log next to the request id, which is the
   * only thing the client gets to correlate with.
   */
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;

    if (status >= 500) {
      request.log.error({ err: error, reqId: request.id }, 'request failed');

      return reply.code(status).send({
        message: 'Internal server error',
        requestId: request.id,
      });
    }

    /*
     * 4xx are the schemas and the guards talking: their message is meant to be
     * read by the client. No stack - an anonymous request hitting a guarded
     * route is the normal case, and a stack trace per 401 buries the log.
     */
    request.log.debug({ statusCode: status, reason: error.message }, 'request rejected');

    return reply.code(status).send({ message: error.message });
  });

  /** Liveness: the process is up. Says nothing about its dependencies. */
  app.get('/healthz', { logLevel: 'warn' }, async () => ({ status: 'ok' }));

  /**
   * Readiness: the things this process cannot serve without actually answer.
   * The gateway is reported but does not fail the check - the API is useful for
   * reading stored conversations and dashboards while Power BI is unreachable.
   */
  app.get('/readyz', { logLevel: 'warn' }, async (_request, reply) => {
    const [database, gateway] = await Promise.all([
      app.db
        .execute(sql`select 1`)
        .then(() => true)
        .catch(() => false),
      app.executor.health(),
    ]);

    if (!database) return reply.code(503).send({ status: 'unavailable', database, gateway });

    return { status: 'ok', database, gateway };
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(datasetRoutes, { prefix: '/api/dataset' });
  await app.register(chatRoutes, { prefix: '/api' });
  await app.register(conversationRoutes, { prefix: '/api/conversations' });
  await app.register(dashboardRoutes, { prefix: '/api/dashboards' });
  await app.register(userRoutes, { prefix: '/api/users' });

  app.get('/api/openapi.json', { logLevel: 'warn' }, async () => app.swagger());

  if (bootstrap) app.addHook('onReady', () => bootstrapDatasets(app));

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;

/**
 * Points the app at the Power BI model named in the environment and brings its
 * catalogue up to date. Deliberately fire and forget: a model with hundreds of
 * columns takes tens of seconds, and Power BI being unreachable must not stop the
 * API from serving what it already knows.
 */
function bootstrapDatasets(app: App): void {
  void (async () => {
    await provision(app);
    if (env.INTROSPECT_ON_STARTUP) await refreshStaleCatalogue(app);
  })().catch((cause) => app.log.error({ cause }, 'dataset bootstrap crashed'));
}

/**
 * The environment is the only authority on which model the app talks to, so this
 * runs on every boot - before the catalogue refresh, so that a source that just
 * changed is rediscovered in the same start.
 */
async function provision(app: App): Promise<void> {
  const outcome = await provisionDatasetFromEnv(app.db);

  if (outcome.status === 'unconfigured') {
    const active = await findActiveDataset(app.db);
    app.log.warn(
      { active: active?.name ?? null },
      'no Power BI source in the environment (PBI_*): serving whatever catalogue the database holds',
    );

    return;
  }

  if (outcome.status === 'repointed') {
    app.log.warn(
      { dataset: outcome.datasetId, from: outcome.from, to: outcome.name },
      `the environment now points at "${outcome.name}": catalogue and generated context discarded`,
    );
  } else {
    app.log.info(
      { dataset: outcome.datasetId },
      `Power BI source ${outcome.status} from the environment: "${outcome.name}"`,
    );
  }

  const orphans = await findOrphanedDatasets(app.db, outcome.datasetId);
  if (orphans.length > 0) {
    app.log.warn(
      { orphans },
      `${orphans.length} dataset row(s) the environment does not point at: unreachable, not deleted`,
    );
  }
}

/** Only the active model is refreshed: an orphan row describes nothing the app serves. */
async function refreshStaleCatalogue(app: App): Promise<void> {
  const dataset = await findActiveDataset(app.db);
  if (!dataset || !isCatalogueStale(dataset, env.INTROSPECT_MAX_AGE_HOURS)) return;

  try {
    const report = await syncDataset({
      db: app.db,
      executor: app.executor,
      datasetId: dataset.id,
      log: app.log,
    });

    app.log.info(
      { dataset: dataset.name, ...report },
      `introspected "${dataset.name}" in ${report.durationMs}ms`,
    );
  } catch (cause) {
    app.log.error({ dataset: dataset.name, cause }, 'introspection failed');
  }
}

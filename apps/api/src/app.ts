import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { User } from '@powerbia/contracts';
import { createDatabase, type Database } from '@powerbia/db';
import Fastify, { type FastifyRequest } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { findSessionUser, SESSION_COOKIE } from './auth/sessions.js';
import { findStaleDatasets, introspectDataset } from './datasets/introspect.js';
import { createGatewayExecutor, type DaxExecutor } from './dax/executor.js';
import { env } from './env.js';
import { authRoutes } from './routes/auth.js';
import { chatRoutes } from './routes/chat.js';
import { conversationRoutes } from './routes/conversations.js';
import { dashboardRoutes } from './routes/dashboards.js';
import { datasetRoutes } from './routes/datasets.js';

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
  if (!request.user) {
    const error = new Error('Authentication required') as Error & { statusCode?: number };
    error.statusCode = 401;
    throw error;
  }

  return request.user;
}

/** Introspection and dataset settings hit the customer's capacity, so they are gated. */
export function requireAdmin(request: FastifyRequest): User {
  const user = requireUser(request);

  if (user.role !== 'admin') {
    const error = new Error('Admin only') as Error & { statusCode?: number };
    error.statusCode = 403;
    throw error;
  }

  return user;
}

export async function buildApp() {
  const app = Fastify({
    logger:
      env.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty' }, level: 'debug' }
        : { level: 'info' },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('db', createDatabase(env.DATABASE_URL));
  app.decorate('executor', createGatewayExecutor(env.DAX_GATEWAY_URL, env.DAX_GATEWAY_TOKEN));
  app.decorateRequest('user', null);

  await app.register(helmet);
  await app.register(cookie, { secret: env.SESSION_COOKIE_SECRET });
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

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

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(datasetRoutes, { prefix: '/api/datasets' });
  await app.register(chatRoutes, { prefix: '/api' });
  await app.register(conversationRoutes, { prefix: '/api/conversations' });
  await app.register(dashboardRoutes, { prefix: '/api/dashboards' });

  if (env.INTROSPECT_ON_STARTUP) app.addHook('onReady', () => refreshStaleCatalogues(app));

  return app;
}

/**
 * Brings every dataset's catalogue up to date at boot. Deliberately fire and
 * forget: a model with hundreds of columns takes tens of seconds, and Power BI
 * being unreachable must not stop the API from serving what it already knows.
 */
function refreshStaleCatalogues(app: Awaited<ReturnType<typeof buildApp>>): void {
  void (async () => {
    const stale = await findStaleDatasets(app.db, env.INTROSPECT_MAX_AGE_HOURS);
    if (stale.length === 0) return;

    app.log.info(`introspecting ${stale.length} dataset(s) with a stale catalogue`);

    for (const dataset of stale) {
      try {
        const report = await introspectDataset({
          db: app.db,
          executor: app.executor,
          datasetId: dataset.id,
        });

        app.log.info(
          { dataset: dataset.name, ...report },
          `introspected "${dataset.name}" in ${report.durationMs}ms`,
        );
      } catch (cause) {
        app.log.error({ dataset: dataset.name, cause }, 'introspection failed');
      }
    }
  })().catch((cause) => app.log.error({ cause }, 'startup introspection crashed'));
}

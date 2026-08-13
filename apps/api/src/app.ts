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

  return app;
}

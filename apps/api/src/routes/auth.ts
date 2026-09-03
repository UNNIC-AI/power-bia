import {
  changePasswordSchema,
  errorSchema,
  loginSchema,
  registerSchema,
  setupStateSchema,
  userSchema,
} from '@powerbia/contracts';
import { schema } from '@powerbia/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireUser } from '../app.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import {
  createSession,
  deleteSession,
  deleteUserSessions,
  SESSION_COOKIE,
} from '../auth/sessions.js';
import { env } from '../env.js';

/** Brute force on a password is the one attack a global 120/min does not slow down. */
const AUTH_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;

const cookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
  secure: env.NODE_ENV === 'production',
  path: '/',
} as const;

export async function authRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  async function anyUserExists(): Promise<boolean> {
    return (await app.db.query.users.findFirst({ columns: { id: true } })) !== undefined;
  }

  /** Public: the login page renders the first-admin form only while this is true. */
  route.get('/setup', { schema: { response: { 200: setupStateSchema } } }, async () => ({
    needsSetup: !(await anyUserExists()),
  }));

  /*
   * Bootstrap only. Accounts are created by an admin from the Users dialog, so
   * this route exists purely to claim an empty instance - otherwise there is no
   * way to become an admin except editing `role` by hand in SQL.
   */
  route.post(
    '/register',
    {
      // Credential endpoints get their own budget, well under the global one.
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: {
        body: registerSchema,
        response: { 200: userSchema, 403: errorSchema, 500: errorSchema },
      },
    },
    async (request, reply) => {
      const { email, password, displayName } = request.body;

      if (await anyUserExists()) {
        return reply
          .code(403)
          .send({ message: 'Registration is closed. Ask an admin for an account' });
      }

      const [user] = await app.db
        .insert(schema.users)
        .values({
          email,
          displayName,
          passwordHash: await hashPassword(password),
          role: 'admin',
        })
        .returning();
      if (!user) return reply.code(500).send({ message: 'Could not create user' });

      const { token, expiresAt } = await createSession(app.db, user.id);
      reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });

      return userSchema.parse(user);
    },
  );

  route.post(
    '/login',
    {
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: { body: loginSchema, response: { 200: userSchema, 401: errorSchema } },
    },
    async (request, reply) => {
      const { email, password } = request.body;

      const user = await app.db.query.users.findFirst({ where: eq(schema.users.email, email) });
      if (!user || !(await verifyPassword(password, user.passwordHash))) {
        return reply.code(401).send({ message: 'Invalid email or password' });
      }

      const { token, expiresAt } = await createSession(app.db, user.id);
      reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });

      return userSchema.parse(user);
    },
  );

  /**
   * The one thing a member may change about their own account. Email, name and
   * role are an admin's business - see `routes/users.ts`.
   */
  route.post(
    '/password',
    {
      schema: {
        body: changePasswordSchema,
        response: { 200: z.object({ ok: z.literal(true) }), 401: errorSchema },
      },
    },
    async (request, reply) => {
      const session = requireUser(request);
      const { currentPassword, newPassword } = request.body;

      const user = await app.db.query.users.findFirst({ where: eq(schema.users.id, session.id) });
      if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
        return reply.code(401).send({ message: 'Current password is incorrect' });
      }

      await app.db
        .update(schema.users)
        .set({ passwordHash: await hashPassword(newPassword) })
        .where(eq(schema.users.id, user.id));

      await deleteUserSessions(app.db, user.id, request.cookies[SESSION_COOKIE]);

      return { ok: true } as const;
    },
  );

  route.post('/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await deleteSession(app.db, token);

    reply.clearCookie(SESSION_COOKIE, cookieOptions);

    return { ok: true };
  });

  route.get('/me', async (request) => requireUser(request));
}

import { loginSchema, registerSchema, userSchema } from '@powerbia/contracts';
import { schema } from '@powerbia/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requireUser } from '../app.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { createSession, deleteSession, SESSION_COOKIE } from '../auth/sessions.js';
import { env } from '../env.js';

const cookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
  secure: env.NODE_ENV === 'production',
  path: '/',
} as const;

export async function authRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.post('/register', { schema: { body: registerSchema } }, async (request, reply) => {
    const { email, password, displayName } = request.body;

    const existing = await app.db.query.users.findFirst({
      where: eq(schema.users.email, email),
    });
    if (existing) return reply.code(409).send({ message: 'Email already registered' });

    const [user] = await app.db
      .insert(schema.users)
      .values({ email, displayName, passwordHash: await hashPassword(password) })
      .returning();
    if (!user) return reply.code(500).send({ message: 'Could not create user' });

    const { token, expiresAt } = await createSession(app.db, user.id);
    reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });

    return userSchema.parse(user);
  });

  route.post('/login', { schema: { body: loginSchema } }, async (request, reply) => {
    const { email, password } = request.body;

    const user = await app.db.query.users.findFirst({ where: eq(schema.users.email, email) });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return reply.code(401).send({ message: 'Invalid email or password' });
    }

    const { token, expiresAt } = await createSession(app.db, user.id);
    reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });

    return userSchema.parse(user);
  });

  route.post('/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await deleteSession(app.db, token);

    reply.clearCookie(SESSION_COOKIE, cookieOptions);

    return { ok: true };
  });

  route.get('/me', async (request) => requireUser(request));
}

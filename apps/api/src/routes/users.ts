import {
  createUserSchema,
  errorSchema,
  resetPasswordSchema,
  userSchema,
} from '@powerbia/contracts';
import { schema } from '@powerbia/db';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAdmin } from '../app.js';
import { hashPassword } from '../auth/passwords.js';
import { deleteUserSessions } from '../auth/sessions.js';

const paramsSchema = z.object({ id: z.uuid() });
const okSchema = z.object({ ok: z.literal(true) });

/**
 * Account administration. Self-registration is closed (`routes/auth.ts`), so
 * this is the only way accounts come into existence after the first one.
 */
export async function userRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.get('/', { schema: { response: { 200: z.array(userSchema) } } }, async (request) => {
    requireAdmin(request);

    return app.db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        displayName: schema.users.displayName,
        role: schema.users.role,
      })
      .from(schema.users)
      .orderBy(asc(schema.users.createdAt));
  });

  route.post(
    '/',
    {
      schema: {
        body: createUserSchema,
        response: { 201: userSchema, 409: errorSchema, 500: errorSchema },
      },
    },
    async (request, reply) => {
      requireAdmin(request);
      const { email, password, displayName, role } = request.body;

      const existing = await app.db.query.users.findFirst({
        where: eq(schema.users.email, email),
      });
      if (existing) return reply.code(409).send({ message: 'Email already registered' });

      const [user] = await app.db
        .insert(schema.users)
        .values({ email, displayName, passwordHash: await hashPassword(password), role })
        .returning();
      if (!user) return reply.code(500).send({ message: 'Could not create user' });

      return reply.code(201).send(userSchema.parse(user));
    },
  );

  /** Sets a password the admin then passes on; every session of that user dies. */
  route.post(
    '/:id/password',
    {
      schema: {
        params: paramsSchema,
        body: resetPasswordSchema,
        response: { 200: okSchema, 404: errorSchema },
      },
    },
    async (request, reply) => {
      requireAdmin(request);

      const target = await app.db.query.users.findFirst({
        where: eq(schema.users.id, request.params.id),
      });
      if (!target) return reply.code(404).send({ message: 'User not found' });

      await app.db
        .update(schema.users)
        .set({ passwordHash: await hashPassword(request.body.password) })
        .where(eq(schema.users.id, target.id));

      await deleteUserSessions(app.db, target.id);

      return { ok: true } as const;
    },
  );

  /*
   * Conversations and dashboards are owned rows and go with the account - the FK
   * cascade in the schema does that. Removing yourself is refused because it
   * could leave the instance with no admin at all.
   */
  route.delete(
    '/:id',
    {
      schema: {
        params: paramsSchema,
        response: { 200: okSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    async (request, reply) => {
      const admin = requireAdmin(request);
      if (admin.id === request.params.id) {
        return reply.code(409).send({ message: 'You cannot remove your own account' });
      }

      const [deleted] = await app.db
        .delete(schema.users)
        .where(eq(schema.users.id, request.params.id))
        .returning({ id: schema.users.id });
      if (!deleted) return reply.code(404).send({ message: 'User not found' });

      return { ok: true } as const;
    },
  );
}

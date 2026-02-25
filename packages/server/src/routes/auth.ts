import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { signupSchema, loginSchema } from '../schemas/auth.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signJwt, verifyJwt } from '../auth/jwt.js';
import { users, sessions } from '../db/schema.js';

export async function authRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post('/api/auth/signup', {
    schema: { body: signupSchema },
  }, async (request, reply) => {
    const { email, password, name } = request.body;

    const existing = await app.db.select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing.length > 0) {
      return reply.code(409).send({ error: 'Email already registered' });
    }

    const id = randomUUID();
    const passwordHash = await hashPassword(password);

    await app.db.insert(users).values({
      id,
      email,
      passwordHash,
      name,
      plan: 'free',
      creditsRemaining: 10000,
    });

    const token = await signJwt(
      { sub: id, email, plan: 'free' },
      app.config.jwtSecret,
    );

    return reply.code(201).send({
      user: { id, email, name, plan: 'free', creditsRemaining: 10000 },
      token,
    });
  });

  server.post('/api/auth/login', {
    schema: { body: loginSchema },
  }, async (request, reply) => {
    const { email, password } = request.body;

    const userRows = await app.db.select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (userRows.length === 0) {
      return reply.code(401).send({ error: 'Invalid email or password' });
    }

    const user = userRows[0];
    const valid = await verifyPassword(password, user.passwordHash);

    if (!valid) {
      return reply.code(401).send({ error: 'Invalid email or password' });
    }

    const token = await signJwt(
      { sub: user.id, email: user.email, plan: user.plan },
      app.config.jwtSecret,
    );

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        creditsRemaining: user.creditsRemaining,
      },
      token,
    });
  });

  server.post('/api/auth/refresh', {
    schema: {
      body: z.object({ token: z.string() }),
    },
  }, async (request, reply) => {
    const { token } = request.body;

    try {
      const payload = await verifyJwt(token, app.config.jwtSecret);

      const userRows = await app.db.select()
        .from(users)
        .where(eq(users.id, payload.sub))
        .limit(1);

      if (userRows.length === 0) {
        return reply.code(401).send({ error: 'User not found' });
      }

      const user = userRows[0];
      const newToken = await signJwt(
        { sub: user.id, email: user.email, plan: user.plan },
        app.config.jwtSecret,
      );

      return reply.send({ token: newToken });
    } catch {
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }
  });

  server.get('/api/auth/me', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const userId = request.userId!;

    const userRows = await app.db.select({
      id: users.id,
      email: users.email,
      name: users.name,
      plan: users.plan,
      creditsRemaining: users.creditsRemaining,
      createdAt: users.createdAt,
    })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (userRows.length === 0) {
      return reply.code(404).send({ error: 'User not found' });
    }

    return reply.send({ user: userRows[0] });
  });

  server.post('/api/auth/logout', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const userId = request.userId!;
    await app.db.delete(sessions).where(eq(sessions.userId, userId));
    return reply.send({ ok: true });
  });
}

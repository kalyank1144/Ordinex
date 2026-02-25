import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { signupSchema, loginSchema, refreshSchema } from '../schemas/auth.js';
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

    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const token = await signJwt(
      { sub: id, email, plan: 'free', sid: sessionId },
      app.config.jwtSecret,
    );

    await app.db.insert(sessions).values({
      id: sessionId,
      userId: id,
      tokenHash: sessionId,
      expiresAt,
    });

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

    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const token = await signJwt(
      { sub: user.id, email: user.email, plan: user.plan, sid: sessionId },
      app.config.jwtSecret,
    );

    await app.db.insert(sessions).values({
      id: sessionId,
      userId: user.id,
      tokenHash: sessionId,
      expiresAt,
    });

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
      body: refreshSchema,
    },
  }, async (request, reply) => {
    const { token } = request.body;

    try {
      const payload = await verifyJwt(token, app.config.jwtSecret);

      if (payload.sid) {
        const oldSession = await app.db.select({ id: sessions.id })
          .from(sessions)
          .where(eq(sessions.id, payload.sid))
          .limit(1);

        if (oldSession.length === 0) {
          return reply.code(401).send({ error: 'Session has been revoked' });
        }

        await app.db.delete(sessions).where(eq(sessions.id, payload.sid));
      }

      const userRows = await app.db.select()
        .from(users)
        .where(eq(users.id, payload.sub))
        .limit(1);

      if (userRows.length === 0) {
        return reply.code(401).send({ error: 'User not found' });
      }

      const user = userRows[0];
      const newSessionId = randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const newToken = await signJwt(
        { sub: user.id, email: user.email, plan: user.plan, sid: newSessionId },
        app.config.jwtSecret,
      );

      await app.db.insert(sessions).values({
        id: newSessionId,
        userId: user.id,
        tokenHash: newSessionId,
        expiresAt,
      });

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

  server.get('/api/auth/vscode-callback', {
    schema: {
      querystring: z.object({
        token: z.string().min(1),
      }),
    },
  }, async (request, reply) => {
    const { token } = request.query;

    try {
      await verifyJwt(token, app.config.jwtSecret);
    } catch {
      return reply.code(400).send({ error: 'Invalid token' });
    }

    const redirectUri = `vscode://ordinex.auth?token=${encodeURIComponent(token)}`;
    return reply.redirect(redirectUri);
  });

  server.post('/api/auth/logout', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const userId = request.userId!;
    await app.db.delete(sessions).where(eq(sessions.userId, userId));
    return reply.send({ ok: true });
  });
}

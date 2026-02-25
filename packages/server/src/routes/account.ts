import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { randomUUID, randomBytes, createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import { users, apiKeys } from '../db/schema.js';

export async function accountRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get('/api/account/profile', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const userId = request.userId!;

    const rows = await app.db.select({
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

    if (rows.length === 0) {
      return reply.code(404).send({ error: 'User not found' });
    }

    return { user: rows[0] };
  });

  server.put('/api/account/profile', {
    preHandler: [app.authenticate],
    schema: {
      body: z.object({
        name: z.string().min(1).max(100).optional(),
      }),
    },
  }, async (request, reply) => {
    const userId = request.userId!;
    const { name } = request.body;

    if (name) {
      await app.db.update(users)
        .set({ name, updatedAt: new Date().toISOString() })
        .where(eq(users.id, userId));
    }

    const rows = await app.db.select({
      id: users.id,
      email: users.email,
      name: users.name,
      plan: users.plan,
      creditsRemaining: users.creditsRemaining,
    })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return { user: rows[0] };
  });

  server.get('/api/account/keys', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.userId!;

    const rows = await app.db.select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    })
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId));

    return { keys: rows };
  });

  server.post('/api/account/keys', {
    preHandler: [app.authenticate],
    schema: {
      body: z.object({
        name: z.string().min(1).max(100),
      }),
    },
  }, async (request, reply) => {
    const userId = request.userId!;
    const { name } = request.body;

    const rawKey = `ok_${randomBytes(32).toString('hex')}`;
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.slice(0, 10);

    const id = randomUUID();
    await app.db.insert(apiKeys).values({
      id,
      userId,
      keyHash,
      keyPrefix,
      name,
    });

    return reply.code(201).send({
      key: { id, name, keyPrefix, rawKey, createdAt: new Date().toISOString() },
    });
  });

  server.delete('/api/account/keys/:keyId', {
    preHandler: [app.authenticate],
    schema: {
      params: z.object({
        keyId: z.string().uuid(),
      }),
    },
  }, async (request, reply) => {
    const userId = request.userId!;
    const { keyId } = request.params;

    const rows = await app.db.select({ id: apiKeys.id })
      .from(apiKeys)
      .where(eq(apiKeys.id, keyId))
      .limit(1);

    if (rows.length === 0) {
      return reply.code(404).send({ error: 'API key not found' });
    }

    await app.db.delete(apiKeys)
      .where(eq(apiKeys.id, keyId));

    return { ok: true };
  });
}

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { verifyJwt } from '../auth/jwt.js';
import { sessions } from '../db/schema.js';
import type { ServerConfig } from '../config.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
    sessionId?: string;
  }
}

export async function registerAuth(app: FastifyInstance, config: ServerConfig) {
  app.decorateRequest('userId', undefined);
  app.decorateRequest('sessionId', undefined);

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'Missing or invalid authorization header' });
      return;
    }

    const token = authHeader.slice(7);
    try {
      const payload = await verifyJwt(token, config.jwtSecret);

      if (payload.sid) {
        const sessionRows = await app.db.select({ id: sessions.id })
          .from(sessions)
          .where(eq(sessions.id, payload.sid))
          .limit(1);

        if (sessionRows.length === 0) {
          reply.code(401).send({ error: 'Session has been revoked' });
          return;
        }
      }

      request.userId = payload.sub;
      request.sessionId = payload.sid;
    } catch {
      reply.code(401).send({ error: 'Invalid or expired token' });
    }
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

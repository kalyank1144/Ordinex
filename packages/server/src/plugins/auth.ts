import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyJwt } from '../auth/jwt.js';
import type { ServerConfig } from '../config.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
  }
}

export async function registerAuth(app: FastifyInstance, config: ServerConfig) {
  app.decorateRequest('userId', undefined);

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'Missing or invalid authorization header' });
      return;
    }

    const token = authHeader.slice(7);
    try {
      const payload = await verifyJwt(token, config.jwtSecret);
      request.userId = payload.sub;
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

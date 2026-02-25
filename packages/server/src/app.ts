import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { ServerConfig } from './config.js';
import type { Database } from './db/index.js';
import { registerCors } from './plugins/cors.js';
import { registerAuth } from './plugins/auth.js';
import { authRoutes } from './routes/auth.js';
import { llmRoutes } from './routes/llm.js';
import { usageRoutes } from './routes/usage.js';
import { accountRoutes } from './routes/account.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    config: ServerConfig;
  }
}

export async function buildApp(config: ServerConfig, db: Database) {
  const app = Fastify({
    logger: config.nodeEnv !== 'test',
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('db', db);
  app.decorate('config', config);

  await registerCors(app, config);
  await registerAuth(app, config);

  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.0.1',
  }));

  await app.register(authRoutes);
  await app.register(llmRoutes);
  await app.register(usageRoutes);
  await app.register(accountRoutes);

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const dashboardDir = resolve(__dirname, '../../dashboard/dist');

  if (existsSync(dashboardDir)) {
    await app.register(fastifyStatic, {
      root: dashboardDir,
      prefix: '/',
      wildcard: false,
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        reply.code(404).send({ error: 'Not found' });
      } else {
        reply.sendFile('index.html');
      }
    });
  }

  return app;
}

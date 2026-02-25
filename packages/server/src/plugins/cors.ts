import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { ServerConfig } from '../config.js';

export async function registerCors(app: FastifyInstance, config: ServerConfig) {
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) {
        cb(null, true);
        return;
      }

      const allowed = config.corsOrigins.some(o => origin.startsWith(o))
        || origin.startsWith('vscode-webview://');

      cb(null, allowed);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
}

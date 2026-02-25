import { randomBytes } from 'crypto';

export interface ServerConfig {
  port: number;
  host: string;
  jwtSecret: string;
  dbPath: string;
  anthropicApiKey: string;
  corsOrigins: string[];
  nodeEnv: 'development' | 'production' | 'test';
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(): ServerConfig {
  const nodeEnv = (process.env.NODE_ENV || 'development') as ServerConfig['nodeEnv'];
  const isDev = nodeEnv === 'development';

  return {
    port: parseInt(process.env.PORT || '3741', 10),
    host: process.env.HOST || '0.0.0.0',
    nodeEnv,

    jwtSecret: process.env.JWT_SECRET || (isDev
      ? 'ordinex-dev-secret-do-not-use-in-production'
      : requireEnv('JWT_SECRET')),

    dbPath: process.env.DB_PATH || 'file:ordinex.db',

    anthropicApiKey: process.env.ANTHROPIC_API_KEY || (isDev
      ? ''
      : requireEnv('ANTHROPIC_API_KEY')),

    corsOrigins: [
      'http://localhost:3741',
      'http://localhost:5173',
      ...(process.env.CORS_ORIGINS?.split(',').map(s => s.trim()) || []),
    ],
  };
}

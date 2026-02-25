import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import { initDatabase, type Database } from '../db/index.js';
import type { ServerConfig } from '../config.js';

const TEST_CONFIG: ServerConfig = {
  port: 0,
  host: '127.0.0.1',
  jwtSecret: 'test-secret-key-for-testing-only',
  dbPath: ':memory:',
  anthropicApiKey: 'test-key',
  corsOrigins: ['http://localhost:3741'],
  nodeEnv: 'test',
};

describe('Server Foundation (A1.1)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let db: Database;

  beforeAll(async () => {
    db = await initDatabase(TEST_CONFIG.dbPath);
    app = await buildApp(TEST_CONFIG, db);

    app.get('/test-protected', { preHandler: [app.authenticate] }, async (request) => ({
      ok: true,
      userId: request.userId,
    }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responds to health check', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.version).toBe('0.0.1');
    expect(body.timestamp).toBeDefined();
  });

  it('has database decorated on app', () => {
    expect(app.db).toBeDefined();
  });

  it('has config decorated on app', () => {
    expect(app.config).toBeDefined();
    expect(app.config.nodeEnv).toBe('test');
  });

  it('has authenticate decorator', () => {
    expect(app.authenticate).toBeDefined();
    expect(typeof app.authenticate).toBe('function');
  });

  it('rejects unauthenticated requests to protected endpoints', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/test-protected',
    });
    expect(response.statusCode).toBe(401);
  });

  it('accepts authenticated requests with valid JWT', async () => {
    const { signJwt } = await import('../auth/jwt.js');
    const token = await signJwt(
      { sub: 'user-123', email: 'test@example.com', plan: 'free' },
      TEST_CONFIG.jwtSecret,
    );

    const response = await app.inject({
      method: 'GET',
      url: '/test-protected',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('Database Schema', () => {
  let db: Database;

  beforeAll(async () => {
    db = await initDatabase(':memory:');
  });

  it('creates users table', async () => {
    const result = await db.run(
      sql`SELECT name FROM sqlite_master WHERE type='table' AND name='users'`,
    );
    expect(result).toBeDefined();
  });

  it('creates sessions table', async () => {
    const result = await db.run(
      sql`SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'`,
    );
    expect(result).toBeDefined();
  });

  it('creates usage_logs table', async () => {
    const result = await db.run(
      sql`SELECT name FROM sqlite_master WHERE type='table' AND name='usage_logs'`,
    );
    expect(result).toBeDefined();
  });

  it('creates api_keys table', async () => {
    const result = await db.run(
      sql`SELECT name FROM sqlite_master WHERE type='table' AND name='api_keys'`,
    );
    expect(result).toBeDefined();
  });
});

describe('JWT', () => {
  it('signs and verifies tokens', async () => {
    const { signJwt, verifyJwt } = await import('../auth/jwt.js');
    const payload = { sub: 'user-abc', email: 'test@test.com', plan: 'pro' };
    const token = await signJwt(payload, 'my-secret');
    const verified = await verifyJwt(token, 'my-secret');
    expect(verified.sub).toBe('user-abc');
    expect(verified.email).toBe('test@test.com');
    expect(verified.plan).toBe('pro');
  });

  it('rejects tokens with wrong secret', async () => {
    const { signJwt, verifyJwt } = await import('../auth/jwt.js');
    const token = await signJwt(
      { sub: 'user-1', email: 'a@b.com', plan: 'free' },
      'secret-a',
    );
    await expect(verifyJwt(token, 'secret-b')).rejects.toThrow();
  });
});

describe('Password Hashing', () => {
  it('hashes and verifies passwords', async () => {
    const { hashPassword, verifyPassword } = await import('../auth/password.js');
    const hash = await hashPassword('my-secure-password');
    expect(hash).not.toBe('my-secure-password');
    expect(await verifyPassword('my-secure-password', hash)).toBe(true);
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });
});

describe('Zod Schemas', () => {
  it('validates signup input', async () => {
    const { signupSchema } = await import('../schemas/auth.js');
    const valid = signupSchema.safeParse({
      email: 'user@example.com',
      password: 'password123',
      name: 'Test User',
    });
    expect(valid.success).toBe(true);

    const invalid = signupSchema.safeParse({
      email: 'not-an-email',
      password: 'short',
      name: '',
    });
    expect(invalid.success).toBe(false);
  });

  it('validates login input', async () => {
    const { loginSchema } = await import('../schemas/auth.js');
    const valid = loginSchema.safeParse({
      email: 'user@example.com',
      password: 'password123',
    });
    expect(valid.success).toBe(true);
  });
});

import { sql } from 'drizzle-orm';

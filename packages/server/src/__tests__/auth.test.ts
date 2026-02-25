import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildApp } from '../app.js';
import { initDatabase, type Database } from '../db/index.js';
import type { ServerConfig } from '../config.js';
import { sql } from 'drizzle-orm';

const TEST_CONFIG: ServerConfig = {
  port: 0,
  host: '127.0.0.1',
  jwtSecret: 'test-secret-key-for-auth-tests',
  dbPath: ':memory:',
  anthropicApiKey: 'test-key',
  corsOrigins: ['http://localhost:3741'],
  nodeEnv: 'test',
};

describe('Auth Routes (A1.2)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let db: Database;

  beforeAll(async () => {
    db = await initDatabase(TEST_CONFIG.dbPath);
    app = await buildApp(TEST_CONFIG, db);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.run(sql`DELETE FROM sessions`);
    await db.run(sql`DELETE FROM usage_logs`);
    await db.run(sql`DELETE FROM api_keys`);
    await db.run(sql`DELETE FROM users`);
  });

  describe('POST /api/auth/signup', () => {
    it('creates a new user and returns JWT', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          email: 'alice@example.com',
          password: 'password123',
          name: 'Alice',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.user.email).toBe('alice@example.com');
      expect(body.user.name).toBe('Alice');
      expect(body.user.plan).toBe('free');
      expect(body.user.creditsRemaining).toBe(10000);
      expect(body.token).toBeDefined();
      expect(typeof body.token).toBe('string');
    });

    it('rejects duplicate email', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          email: 'bob@example.com',
          password: 'password123',
          name: 'Bob',
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          email: 'bob@example.com',
          password: 'differentpass',
          name: 'Bob 2',
        },
      });

      expect(response.statusCode).toBe(409);
    });

    it('validates input — short password', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          email: 'test@test.com',
          password: 'short',
          name: 'Test',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('validates input — invalid email', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          email: 'not-an-email',
          password: 'password123',
          name: 'Test',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          email: 'carol@example.com',
          password: 'securepass123',
          name: 'Carol',
        },
      });
    });

    it('returns JWT for valid credentials', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'carol@example.com',
          password: 'securepass123',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.user.email).toBe('carol@example.com');
      expect(body.token).toBeDefined();
    });

    it('rejects invalid password', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'carol@example.com',
          password: 'wrongpassword',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('rejects non-existent email', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'nobody@example.com',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns current user with valid JWT', async () => {
      const signupRes = await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          email: 'dave@example.com',
          password: 'password123',
          name: 'Dave',
        },
      });
      const { token } = JSON.parse(signupRes.body);

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.user.email).toBe('dave@example.com');
      expect(body.user.name).toBe('Dave');
    });

    it('rejects request without token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
      });

      expect(response.statusCode).toBe(401);
    });

    it('rejects request with invalid token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: 'Bearer invalid-token' },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('returns a new JWT for a valid token', async () => {
      const signupRes = await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          email: 'eve@example.com',
          password: 'password123',
          name: 'Eve',
        },
      });
      const { token } = JSON.parse(signupRes.body);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        payload: { token },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.token).toBeDefined();
      expect(typeof body.token).toBe('string');
      expect(body.token.split('.')).toHaveLength(3);
    });

    it('rejects invalid token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        payload: { token: 'bad-token' },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('logs out the user', async () => {
      const signupRes = await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          email: 'frank@example.com',
          password: 'password123',
          name: 'Frank',
        },
      });
      const { token } = JSON.parse(signupRes.body);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
    });
  });

  describe('End-to-end auth flow', () => {
    it('signup -> login -> me -> refresh -> me', async () => {
      const signupRes = await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          email: 'flow@example.com',
          password: 'flowpass123',
          name: 'Flow User',
        },
      });
      expect(signupRes.statusCode).toBe(201);

      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'flow@example.com',
          password: 'flowpass123',
        },
      });
      expect(loginRes.statusCode).toBe(200);
      const loginBody = JSON.parse(loginRes.body);

      const meRes = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${loginBody.token}` },
      });
      expect(meRes.statusCode).toBe(200);
      expect(JSON.parse(meRes.body).user.email).toBe('flow@example.com');

      const refreshRes = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        payload: { token: loginBody.token },
      });
      expect(refreshRes.statusCode).toBe(200);
      const newToken = JSON.parse(refreshRes.body).token;

      const meRes2 = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${newToken}` },
      });
      expect(meRes2.statusCode).toBe(200);
      expect(JSON.parse(meRes2.body).user.email).toBe('flow@example.com');
    });
  });
});

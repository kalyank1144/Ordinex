import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildApp } from '../app.js';
import { initDatabase, type Database } from '../db/index.js';
import type { ServerConfig } from '../config.js';
import { sql } from 'drizzle-orm';
import { logUsage } from '../services/usageTracker.js';

const TEST_CONFIG: ServerConfig = {
  port: 0,
  host: '127.0.0.1',
  jwtSecret: 'test-secret-key-for-usage-tests',
  dbPath: ':memory:',
  anthropicApiKey: 'test-key',
  corsOrigins: ['http://localhost:3741'],
  nodeEnv: 'test',
};

describe('Usage & Account API (A1.6)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let db: Database;
  let authToken: string;
  let userId: string;

  beforeAll(async () => {
    db = await initDatabase(TEST_CONFIG.dbPath);
    app = await buildApp(TEST_CONFIG, db);
    await app.ready();

    const signupRes = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: {
        email: 'usage-test@example.com',
        password: 'password123',
        name: 'Usage Test User',
      },
    });
    const body = JSON.parse(signupRes.body);
    authToken = body.token;
    userId = body.user.id;

    for (let i = 0; i < 5; i++) {
      await logUsage(db, {
        userId,
        model: 'claude-sonnet-4-20250514',
        inputTokens: 100 + i * 50,
        outputTokens: 50 + i * 25,
        endpoint: '/api/llm/messages',
        durationMs: 200 + i * 100,
      });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/usage/summary', () => {
    it('returns monthly usage summary', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/usage/summary',
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.month).toBeDefined();
      expect(body.callCount).toBeGreaterThanOrEqual(5);
      expect(body.totalInputTokens).toBeGreaterThan(0);
      expect(body.totalOutputTokens).toBeGreaterThan(0);
      expect(body.creditsRemaining).toBeDefined();
    });

    it('rejects unauthenticated requests', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/usage/summary',
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /api/usage/daily', () => {
    it('returns daily breakdown', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/usage/daily?days=30',
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.days).toBeDefined();
      expect(Array.isArray(body.days)).toBe(true);
    });

    it('defaults to 30 days', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/usage/daily',
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /api/usage/recent', () => {
    it('returns recent usage logs', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/usage/recent?limit=3',
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.logs).toBeDefined();
      expect(body.logs.length).toBeLessThanOrEqual(3);
    });
  });

  describe('GET /api/account/profile', () => {
    it('returns user profile', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/account/profile',
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.user.email).toBe('usage-test@example.com');
      expect(body.user.name).toBe('Usage Test User');
      expect(body.user.plan).toBe('free');
    });
  });

  describe('PUT /api/account/profile', () => {
    it('updates user name', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/account/profile',
        headers: { authorization: `Bearer ${authToken}` },
        payload: { name: 'Updated Name' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.user.name).toBe('Updated Name');
    });
  });

  describe('API Keys', () => {
    it('creates, lists, and deletes API keys', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/account/keys',
        headers: { authorization: `Bearer ${authToken}` },
        payload: { name: 'Test Key' },
      });

      expect(createRes.statusCode).toBe(201);
      const created = JSON.parse(createRes.body);
      expect(created.key.name).toBe('Test Key');
      expect(created.key.rawKey).toMatch(/^ok_/);
      const keyId = created.key.id;

      const listRes = await app.inject({
        method: 'GET',
        url: '/api/account/keys',
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(listRes.statusCode).toBe(200);
      const listed = JSON.parse(listRes.body);
      expect(listed.keys.length).toBeGreaterThanOrEqual(1);
      expect(listed.keys.some((k: any) => k.id === keyId)).toBe(true);
      expect(listed.keys.every((k: any) => !k.rawKey)).toBe(true);

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/account/keys/${keyId}`,
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(deleteRes.statusCode).toBe(200);

      const listAfter = await app.inject({
        method: 'GET',
        url: '/api/account/keys',
        headers: { authorization: `Bearer ${authToken}` },
      });

      const listedAfter = JSON.parse(listAfter.body);
      expect(listedAfter.keys.some((k: any) => k.id === keyId)).toBe(false);
    });
  });
});

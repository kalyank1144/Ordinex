import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { buildApp } from '../app.js';
import { initDatabase, type Database } from '../db/index.js';
import type { ServerConfig } from '../config.js';
import { sql } from 'drizzle-orm';

vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn().mockResolvedValue({
    id: 'msg_test123',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello from mock!' }],
    model: 'claude-sonnet-4-20250514',
    stop_reason: 'end_turn',
    usage: { input_tokens: 50, output_tokens: 25 },
  });

  return {
    default: class MockAnthropic {
      messages = {
        create: mockCreate,
        stream: vi.fn(),
      };
    },
  };
});

const TEST_CONFIG: ServerConfig = {
  port: 0,
  host: '127.0.0.1',
  jwtSecret: 'test-secret-key-for-llm-tests',
  dbPath: ':memory:',
  anthropicApiKey: 'sk-test-key',
  corsOrigins: ['http://localhost:3741'],
  nodeEnv: 'test',
};

describe('LLM Proxy Routes (A1.3)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let db: Database;
  let authToken: string;

  beforeAll(async () => {
    db = await initDatabase(TEST_CONFIG.dbPath);
    app = await buildApp(TEST_CONFIG, db);
    await app.ready();

    const signupRes = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: {
        email: 'llm-test@example.com',
        password: 'password123',
        name: 'LLM Test User',
      },
    });
    authToken = JSON.parse(signupRes.body).token;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/llm/messages', () => {
    it('proxies a message request to Anthropic', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/llm/messages',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          model: 'claude-sonnet-4-20250514',
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 1024,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.content[0].text).toBe('Hello from mock!');
      expect(body.usage.input_tokens).toBe(50);
    });

    it('rejects unauthenticated requests', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/llm/messages',
        payload: {
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 1024,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('logs usage after successful call', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/llm/messages',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          messages: [{ role: 'user', content: 'Test usage logging' }],
          max_tokens: 512,
        },
      });

      const logs = await db.all(sql`SELECT * FROM usage_logs ORDER BY created_at DESC LIMIT 1`);
      expect(logs.length).toBeGreaterThan(0);
      const log = logs[0] as any;
      expect(log.model).toBe('claude-sonnet-4-20250514');
      expect(log.input_tokens).toBe(50);
      expect(log.output_tokens).toBe(25);
      expect(log.endpoint).toBe('/api/llm/messages');
    });

    it('deducts credits after usage', async () => {
      const meRes = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${authToken}` },
      });

      const user = JSON.parse(meRes.body).user;
      expect(user.creditsRemaining).toBeLessThan(10000);
    });

    it('rejects when credits are depleted', async () => {
      const meRes = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${authToken}` },
      });
      const userId = JSON.parse(meRes.body).user.id;

      await db.run(sql`UPDATE users SET credits_remaining = 0 WHERE id = ${userId}`);

      const response = await app.inject({
        method: 'POST',
        url: '/api/llm/messages',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          messages: [{ role: 'user', content: 'Should fail' }],
          max_tokens: 1024,
        },
      });

      expect(response.statusCode).toBe(402);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Insufficient credits');

      await db.run(sql`UPDATE users SET credits_remaining = 10000 WHERE id = ${userId}`);
    });

    it('validates request body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/llm/messages',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          messages: 'not-an-array',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /api/llm/messages/stream', () => {
    it('rejects unauthenticated requests', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/llm/messages/stream',
        payload: {
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 1024,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('rejects when credits are depleted', async () => {
      const meRes = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${authToken}` },
      });
      const userId = JSON.parse(meRes.body).user.id;

      await db.run(sql`UPDATE users SET credits_remaining = 0 WHERE id = ${userId}`);

      const response = await app.inject({
        method: 'POST',
        url: '/api/llm/messages/stream',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          messages: [{ role: 'user', content: 'Should fail' }],
          max_tokens: 1024,
        },
      });

      expect(response.statusCode).toBe(402);

      await db.run(sql`UPDATE users SET credits_remaining = 10000 WHERE id = ${userId}`);
    });
  });
});

describe('Usage Tracker', () => {
  let db: Database;

  beforeAll(async () => {
    db = await initDatabase(':memory:');
  });

  it('reserves credits atomically and settles after usage', async () => {
    const { logUsage, checkCredits, reserveCredits, settleCredits } = await import('../services/usageTracker.js');
    const { randomUUID } = await import('crypto');
    const { hashPassword } = await import('../auth/password.js');
    const { users } = await import('../db/schema.js');

    const userId = randomUUID();
    const hash = await hashPassword('test');
    await db.insert(users).values({
      id: userId,
      email: 'tracker-test@example.com',
      passwordHash: hash,
      name: 'Tracker Test',
      creditsRemaining: 5000,
    });

    const creditsBefore = await checkCredits(db, userId);
    expect(creditsBefore).toBe(5000);

    const reservation = await reserveCredits(db, userId, 4096);
    expect(reservation).not.toBeNull();
    expect(reservation!.reserved).toBe(4096);

    const creditsAfterReserve = await checkCredits(db, userId);
    expect(creditsAfterReserve).toBe(5000 - 4096);

    const actualTokens = 150;
    await settleCredits(db, userId, reservation!.reserved, actualTokens);

    const creditsAfterSettle = await checkCredits(db, userId);
    expect(creditsAfterSettle).toBe(5000 - actualTokens);

    await logUsage(db, {
      userId,
      model: 'claude-sonnet-4-20250514',
      inputTokens: 100,
      outputTokens: 50,
      endpoint: '/api/llm/messages',
      durationMs: 500,
    });

    const creditsFinal = await checkCredits(db, userId);
    expect(creditsFinal).toBe(5000 - actualTokens);
  });

  it('caps reservation to available credits when estimate exceeds balance', async () => {
    const { reserveCredits, checkCredits } = await import('../services/usageTracker.js');
    const { randomUUID } = await import('crypto');
    const { hashPassword } = await import('../auth/password.js');
    const { users } = await import('../db/schema.js');

    const userId = randomUUID();
    const hash = await hashPassword('test');
    await db.insert(users).values({
      id: userId,
      email: 'tracker-cap-test@example.com',
      passwordHash: hash,
      name: 'Low Credit User',
      creditsRemaining: 100,
    });

    const result = await reserveCredits(db, userId, 4096);
    expect(result).not.toBeNull();
    expect(result!.reserved).toBe(100);
    expect(result!.remaining).toBe(0);

    const credits = await checkCredits(db, userId);
    expect(credits).toBe(0);
  });

  it('rejects reservation when credits are zero', async () => {
    const { reserveCredits, checkCredits } = await import('../services/usageTracker.js');
    const { randomUUID } = await import('crypto');
    const { hashPassword } = await import('../auth/password.js');
    const { users } = await import('../db/schema.js');

    const userId = randomUUID();
    const hash = await hashPassword('test');
    await db.insert(users).values({
      id: userId,
      email: 'tracker-zero-test@example.com',
      passwordHash: hash,
      name: 'Zero Credit User',
      creditsRemaining: 0,
    });

    const result = await reserveCredits(db, userId, 4096);
    expect(result).toBeNull();

    const credits = await checkCredits(db, userId);
    expect(credits).toBe(0);
  });
});

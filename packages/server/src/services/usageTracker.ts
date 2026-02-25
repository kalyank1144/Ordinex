import { randomUUID } from 'crypto';
import type { Database } from '../db/index.js';
import { usageLogs, users } from '../db/schema.js';
import { eq, sql, and, gte } from 'drizzle-orm';

interface UsageEntry {
  userId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  endpoint: string;
  durationMs?: number;
}

const COST_PER_MILLION: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 300, output: 1500 },
  'claude-3-5-sonnet-20241022': { input: 300, output: 1500 },
  'claude-3-5-haiku-20241022': { input: 100, output: 500 },
  'claude-3-haiku-20240307': { input: 25, output: 125 },
};

function estimateCostCents(model: string, inputTokens: number, outputTokens: number): number {
  const rates = COST_PER_MILLION[model] || { input: 300, output: 1500 };
  const inputCost = (inputTokens / 1_000_000) * rates.input;
  const outputCost = (outputTokens / 1_000_000) * rates.output;
  return Math.round((inputCost + outputCost) * 100) / 100;
}

export async function logUsage(db: Database, entry: UsageEntry): Promise<void> {
  const costCents = estimateCostCents(entry.model, entry.inputTokens, entry.outputTokens);

  await db.insert(usageLogs).values({
    id: randomUUID(),
    userId: entry.userId,
    model: entry.model,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    costCents,
    endpoint: entry.endpoint,
    durationMs: entry.durationMs,
  });
}

/**
 * After an LLM call completes, settle the pre-reserved credits.
 * Refunds (reserved - actual) tokens back to the user's balance.
 * If actual > reserved (shouldn't happen), no refund is issued.
 */
export async function settleCredits(db: Database, userId: string, reserved: number, actualTokens: number): Promise<void> {
  const refund = reserved - actualTokens;
  if (refund > 0) {
    await db.run(
      sql`UPDATE users SET credits_remaining = credits_remaining + ${refund}
          WHERE id = ${userId}`
    );
  }
}

/**
 * Atomically reserve credits for an LLM call. Returns the remaining balance
 * after deduction, or -1 if the user has insufficient credits. The UPDATE
 * uses a WHERE guard so the balance can never go below zero.
 */
export async function reserveCredits(db: Database, userId: string, tokens: number): Promise<number> {
  const result = await db.run(
    sql`UPDATE users SET credits_remaining = credits_remaining - ${tokens}
        WHERE id = ${userId} AND credits_remaining >= ${tokens}`
  );

  if (result.rowsAffected === 0) {
    return -1;
  }

  const rows = await db.select({ credits: users.creditsRemaining })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return rows.length > 0 ? rows[0].credits : -1;
}

export async function checkCredits(db: Database, userId: string): Promise<number> {
  const rows = await db.select({ credits: users.creditsRemaining })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (rows.length === 0) return 0;
  return rows[0].credits;
}

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
 * If actual < reserved: refund the excess.
 * If actual > reserved: charge the additional tokens (clamped to 0 floor).
 */
export async function settleCredits(db: Database, userId: string, reserved: number, actualTokens: number): Promise<void> {
  const diff = reserved - actualTokens;
  if (diff > 0) {
    await db.run(
      sql`UPDATE users SET credits_remaining = credits_remaining + ${diff}
          WHERE id = ${userId}`
    );
  } else if (diff < 0) {
    const extra = -diff;
    await db.run(
      sql`UPDATE users SET credits_remaining = MAX(0, credits_remaining - ${extra})
          WHERE id = ${userId}`
    );
  }
}

const MIN_CREDITS_TO_PROCEED = 1;

/**
 * Atomically reserve credits for an LLM call. Reserves up to `tokens`
 * but will reserve whatever the user has if the full estimate exceeds
 * their balance (as long as they have at least MIN_CREDITS_TO_PROCEED).
 * Returns { reserved, remaining } on success, or null if the user has
 * no credits at all.
 */
export async function reserveCredits(db: Database, userId: string, tokens: number): Promise<{ reserved: number; remaining: number } | null> {
  const before = await db.select({ credits: users.creditsRemaining })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (before.length === 0 || before[0].credits < MIN_CREDITS_TO_PROCEED) {
    return null;
  }

  const toDeduct = Math.min(tokens, before[0].credits);

  const result = await db.run(
    sql`UPDATE users SET credits_remaining = credits_remaining - ${toDeduct}
        WHERE id = ${userId} AND credits_remaining >= ${toDeduct}`
  );

  if (result.rowsAffected === 0) {
    return null;
  }

  return { reserved: toDeduct, remaining: before[0].credits - toDeduct };
}

export async function checkCredits(db: Database, userId: string): Promise<number> {
  const rows = await db.select({ credits: users.creditsRemaining })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (rows.length === 0) return 0;
  return rows[0].credits;
}

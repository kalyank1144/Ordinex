import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eq, sql, desc } from 'drizzle-orm';
import { usageLogs, users } from '../db/schema.js';

export async function usageRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get('/api/usage/summary', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.userId!;

    const rows = await app.db.select({
      totalInputTokens: sql<number>`COALESCE(SUM(${usageLogs.inputTokens}), 0)`,
      totalOutputTokens: sql<number>`COALESCE(SUM(${usageLogs.outputTokens}), 0)`,
      totalCostCents: sql<number>`COALESCE(SUM(${usageLogs.costCents}), 0)`,
      callCount: sql<number>`COUNT(*)`,
    })
      .from(usageLogs)
      .where(sql`${usageLogs.userId} = ${userId} AND ${usageLogs.createdAt} >= datetime('now', 'start of month')`);

    const userRows = await app.db.select({ credits: users.creditsRemaining })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const summary = rows[0] || { totalInputTokens: 0, totalOutputTokens: 0, totalCostCents: 0, callCount: 0 };

    return {
      month: new Date().toISOString().slice(0, 7),
      ...summary,
      totalTokens: (summary.totalInputTokens ?? 0) + (summary.totalOutputTokens ?? 0),
      creditsRemaining: userRows[0]?.credits ?? 0,
    };
  });

  server.get('/api/usage/daily', {
    preHandler: [app.authenticate],
    schema: {
      querystring: z.object({
        days: z.coerce.number().int().min(1).max(90).default(30),
      }),
    },
  }, async (request) => {
    const userId = request.userId!;
    const { days } = request.query;

    const rows = await app.db.all(sql`
      SELECT
        date(${usageLogs.createdAt}) as date,
        SUM(${usageLogs.inputTokens}) as input_tokens,
        SUM(${usageLogs.outputTokens}) as output_tokens,
        SUM(${usageLogs.costCents}) as cost_cents,
        COUNT(*) as calls
      FROM ${usageLogs}
      WHERE ${usageLogs.userId} = ${userId}
        AND ${usageLogs.createdAt} >= datetime('now', '-' || ${days} || ' days')
      GROUP BY date(${usageLogs.createdAt})
      ORDER BY date(${usageLogs.createdAt}) ASC
    `);

    return { days: rows };
  });

  server.get('/api/usage/recent', {
    preHandler: [app.authenticate],
    schema: {
      querystring: z.object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
      }),
    },
  }, async (request) => {
    const userId = request.userId!;
    const { limit } = request.query;

    const rows = await app.db.select({
      id: usageLogs.id,
      model: usageLogs.model,
      inputTokens: usageLogs.inputTokens,
      outputTokens: usageLogs.outputTokens,
      costCents: usageLogs.costCents,
      endpoint: usageLogs.endpoint,
      durationMs: usageLogs.durationMs,
      createdAt: usageLogs.createdAt,
    })
      .from(usageLogs)
      .where(eq(usageLogs.userId, userId))
      .orderBy(desc(usageLogs.createdAt))
      .limit(limit);

    return { logs: rows };
  });
}

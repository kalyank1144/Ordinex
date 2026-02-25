import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  plan: text('plan', { enum: ['free', 'pro', 'team'] }).notNull().default('free'),
  creditsRemaining: integer('credits_remaining').notNull().default(10000),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  keyHash: text('key_hash').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  name: text('name').notNull(),
  lastUsedAt: text('last_used_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const usageLogs = sqliteTable('usage_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  costCents: real('cost_cents').notNull().default(0),
  endpoint: text('endpoint').notNull(),
  durationMs: integer('duration_ms'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type UsageLog = typeof usageLogs.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;

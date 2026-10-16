import { bigint, bigserial, boolean, check, date, index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerAccountId: uuid('owner_account_id'),
  scope: varchar('scope', { length: 7 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  monthlyLimit: bigint('monthly_limit', { mode: 'number' }).notNull(),
  maxPerRequest: bigint('max_per_request', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [check('plans_scope_check', sql`${t.scope} IN ('account','user')`), check('plans_limits_check', sql`${t.monthlyLimit} >= 0 AND ${t.monthlyLimit} <= 9007199254740991 AND ${t.maxPerRequest} > 0 AND ${t.maxPerRequest} <= 9007199254740991`), uniqueIndex('plans_global_name_uq').on(t.scope,t.name).where(sql`${t.ownerAccountId} IS NULL`), uniqueIndex('plans_owner_name_uq').on(t.ownerAccountId,t.scope,t.name).where(sql`${t.ownerAccountId} IS NOT NULL`)]);

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  planId: uuid('plan_id').notNull().references(() => plans.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  externalId: varchar('external_id', { length: 100 }).notNull(),
  planId: uuid('plan_id').notNull().references(() => plans.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('users_account_external_uq').on(t.accountId,t.externalId)]);

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  keyHash: text('key_hash').notNull().unique(),
  keyPrefix: varchar('key_prefix', { length: 16 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const accountMonthlyUsage = pgTable('account_monthly_usage', {
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  month: date('month').notNull(),
  used: bigint('used', { mode: 'number' }).notNull().default(0),
}, t => [check('account_usage_nonnegative', sql`${t.used} >= 0`), primaryKey({columns:[t.accountId,t.month]})]);

export const userMonthlyUsage = pgTable('user_monthly_usage', {
  userId: uuid('user_id').notNull().references(() => users.id),
  month: date('month').notNull(),
  used: bigint('used', { mode: 'number' }).notNull().default(0),
}, t => [check('user_usage_nonnegative', sql`${t.used} >= 0`), primaryKey({columns:[t.userId,t.month]})]);

export const consumeRequests = pgTable('consume_requests', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  requestId: varchar('request_id', { length: 128 }).notNull(),
  units: bigint('units', { mode: 'number' }).notNull(),
  accepted: boolean('accepted'),
  rejectedRule: varchar('rejected_rule', { length: 32 }),
  rejectedLevel: varchar('rejected_level', { length: 7 }),
  rejectionLimit: bigint('rejection_limit', { mode: 'number' }),
  accountMonthlyLimit: bigint('account_monthly_limit', { mode: 'number' }),
  accountMaxPerRequest: bigint('account_max_per_request', { mode: 'number' }),
  userMonthlyLimit: bigint('user_monthly_limit', { mode: 'number' }),
  userMaxPerRequest: bigint('user_max_per_request', { mode: 'number' }),
  accountUsedAfter: bigint('account_used_after', { mode: 'number' }),
  userUsedAfter: bigint('user_used_after', { mode: 'number' }),
  month: date('month'),
  createdAt: timestamp('created_at', { withTimezone: true }),
}, t => [uniqueIndex('requests_account_request_uq').on(t.accountId,t.requestId), index('requests_account_id_idx').on(t.accountId,t.id), index('requests_user_id_idx').on(t.accountId,t.userId,t.id), check('requests_units_check', sql`${t.units} > 0 AND ${t.units} <= 9007199254740991`)]);

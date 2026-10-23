import { pool } from '../db/client.js';
import { assert } from '../errors.js';
import { remaining } from '../rules/evaluate.js';
import { numberValue as n } from './common.js';

// null means no month was supplied: PostgreSQL decides the UTC month.
// Explicit dates arrive as validated YYYY-MM-01 strings.
export async function getAccountUsage(accountId: string, month: string | null) {
  const result = await pool.query(
    `WITH period AS (
       SELECT coalesce($2::date, date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC')::date) AS month
     )
     SELECT p.monthly_limit, coalesce(mu.used,0) AS used, period.month::text AS month_text
     FROM accounts a JOIN plans p ON p.id=a.plan_id CROSS JOIN period
     LEFT JOIN account_monthly_usage mu ON mu.account_id=a.id AND mu.month=period.month
     WHERE a.id=$1`,
    [accountId, month],
  );
  const usage = result.rows[0];
  assert(usage, 404, 'not_found', 'Account not found');
  return {
    month: String(usage.month_text).slice(0, 7),
    used: n(usage.used),
    limit: n(usage.monthly_limit),
    remaining: remaining(n(usage.monthly_limit), n(usage.used)),
  };
}

export async function getUserUsage(accountId: string, externalId: string, month: string | null) {
  const result = await pool.query(
    `WITH period AS (
       SELECT coalesce($3::date, date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC')::date) AS month
     )
     SELECT p.monthly_limit, coalesce(mu.used,0) AS used, period.month::text AS month_text
     FROM users u JOIN plans p ON p.id=u.plan_id CROSS JOIN period
     LEFT JOIN user_monthly_usage mu ON mu.user_id=u.id AND mu.month=period.month
     WHERE u.account_id=$1 AND u.external_id=$2`,
    [accountId, externalId, month],
  );
  const usage = result.rows[0];
  assert(usage, 404, 'not_found', 'User not found');
  return {
    month: String(usage.month_text).slice(0, 7),
    userId: externalId,
    used: n(usage.used),
    limit: n(usage.monthly_limit),
    remaining: remaining(n(usage.monthly_limit), n(usage.used)),
  };
}

import { pool } from '../db/client.js';
import { assert } from '../errors.js';
import { remaining } from '../rules/evaluate.js';
import { numberValue as n } from './common.js';

export async function getAccountUsage(accountId: string, month: string) {
  const result = await pool.query(
    'SELECT p.monthly_limit,coalesce(mu.used,0) AS used FROM accounts a JOIN plans p ON p.id=a.plan_id LEFT JOIN account_monthly_usage mu ON mu.account_id=a.id AND mu.month=$2 WHERE a.id=$1',
    [accountId, month],
  );
  const usage = result.rows[0];
  return { month: month.slice(0, 7), used: n(usage.used), limit: n(usage.monthly_limit), remaining: remaining(n(usage.monthly_limit), n(usage.used)) };
}

export async function getUserUsage(accountId: string, externalId: string, month: string) {
  const result = await pool.query(
    'SELECT p.monthly_limit,coalesce(mu.used,0) AS used FROM users u JOIN plans p ON p.id=u.plan_id LEFT JOIN user_monthly_usage mu ON mu.user_id=u.id AND mu.month=$3 WHERE u.account_id=$1 AND u.external_id=$2',
    [accountId, externalId, month],
  );
  const usage = result.rows[0];
  assert(usage, 404, 'not_found', 'User not found');
  return { month: month.slice(0, 7), userId: externalId, used: n(usage.used), limit: n(usage.monthly_limit), remaining: remaining(n(usage.monthly_limit), n(usage.used)) };
}

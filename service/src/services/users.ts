import { pool } from '../db/client.js';
import { assert } from '../errors.js';
import { remaining } from '../rules/evaluate.js';
import { numberValue as n, transaction, visiblePlan } from './common.js';

export async function registerUser(accountId: string, externalId: string, planId: string) {
  await visiblePlan(accountId, planId, 'user');
  const user = await transaction(async client => {
    await client.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE', [accountId]);
    const result = await client.query('INSERT INTO users(account_id,external_id,plan_id) VALUES($1,$2,$3) RETURNING id,external_id,plan_id', [accountId, externalId, planId]);
    return result.rows[0];
  });
  return { id: user.id, externalId: user.external_id, planId: user.plan_id };
}

export async function getUser(accountId: string, externalId: string) {
  const result = await pool.query(
    `SELECT u.id,u.external_id,p.id AS plan_id,p.name AS plan_name,p.monthly_limit,p.max_per_request,coalesce(mu.used,0) AS used FROM users u JOIN plans p ON p.id=u.plan_id LEFT JOIN user_monthly_usage mu ON mu.user_id=u.id AND mu.month=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date WHERE u.account_id=$1 AND u.external_id=$2`,
    [accountId, externalId],
  );
  const user = result.rows[0];
  assert(user, 404, 'not_found', 'User not found');
  return {
    id: user.id,
    externalId: user.external_id,
    plan: { id: user.plan_id, name: user.plan_name, monthlyLimit: n(user.monthly_limit), maxPerRequest: n(user.max_per_request) },
    usage: { used: n(user.used), remaining: remaining(n(user.monthly_limit), n(user.used)) },
  };
}

export async function changeUserPlan(accountId: string, externalId: string, planId: string) {
  await visiblePlan(accountId, planId, 'user');
  await transaction(async client => {
    await client.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE', [accountId]);
    const result = await client.query('UPDATE users SET plan_id=$3,updated_at=clock_timestamp() WHERE account_id=$1 AND external_id=$2 RETURNING id', [accountId, externalId, planId]);
    assert(result.rows[0], 404, 'not_found', 'User not found');
  });
  return { externalId, planId };
}

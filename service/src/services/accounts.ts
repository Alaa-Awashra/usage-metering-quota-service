import { pool } from '../db/client.js';
import { generateKey, hashKey } from '../auth.js';
import { assert } from '../errors.js';
import { remaining } from '../rules/evaluate.js';
import { numberValue as n, planResponse, transaction, visiblePlan } from './common.js';

export async function createAccount(name: string, planName: string) {
  const plan = await pool.query(
    "SELECT * FROM plans WHERE owner_account_id IS NULL AND scope='account' AND lower(name)=lower($1)",
    [planName],
  );
  assert(plan.rows[0], 404, 'not_found', 'Account plan not found');
  const apiKey = generateKey();
  const account = await transaction(async client => {
    const inserted = await client.query('INSERT INTO accounts(name,plan_id) VALUES($1,$2) RETURNING id,name', [name, plan.rows[0].id]);
    await client.query('INSERT INTO api_keys(account_id,key_hash,key_prefix) VALUES($1,$2,$3)', [inserted.rows[0].id, hashKey(apiKey), apiKey.slice(0, 12)]);
    return inserted.rows[0];
  });
  return { ...account, plan: planResponse(plan.rows[0]), apiKey };
}

export async function getAccount(accountId: string) {
  const result = await pool.query(
    `SELECT a.id,a.name,a.created_at,p.id AS plan_id,p.name AS plan_name,p.monthly_limit,p.max_per_request,coalesce(u.used,0) AS used FROM accounts a JOIN plans p ON p.id=a.plan_id LEFT JOIN account_monthly_usage u ON u.account_id=a.id AND u.month=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date WHERE a.id=$1`,
    [accountId],
  );
  const account = result.rows[0];
  assert(account, 404, 'not_found', 'Account not found');
  return {
    id: account.id,
    name: account.name,
    plan: { id: account.plan_id, name: account.plan_name, monthlyLimit: n(account.monthly_limit), maxPerRequest: n(account.max_per_request) },
    usage: { used: n(account.used), remaining: remaining(n(account.monthly_limit), n(account.used)) },
    createdAt: account.created_at,
  };
}

export async function changeAccountPlan(accountId: string, planId: string) {
  await visiblePlan(accountId, planId, 'account');
  await transaction(async client => {
    await client.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE', [accountId]);
    await client.query('UPDATE accounts SET plan_id=$2,updated_at=clock_timestamp() WHERE id=$1', [accountId, planId]);
  });
  return { planId };
}

import { pool } from '../db/client.js';
import { assert } from '../errors.js';
import { planResponse, transaction } from './common.js';

export async function listPlans(accountId: string) {
  const result = await pool.query('SELECT * FROM plans WHERE owner_account_id IS NULL OR owner_account_id=$1 ORDER BY scope,name', [accountId]);
  return result.rows.map(planResponse);
}

export async function createPlan(accountId: string, input: { name: string; scope: 'account' | 'user'; monthlyLimit: number; maxPerRequest: number }) {
  const result = await pool.query(
    'INSERT INTO plans(owner_account_id,scope,name,monthly_limit,max_per_request) VALUES($1,$2,$3,$4,$5) RETURNING *',
    [accountId, input.scope, input.name, input.monthlyLimit, input.maxPerRequest],
  );
  return planResponse(result.rows[0]);
}

export async function getPlan(accountId: string, planId: string) {
  const result = await pool.query('SELECT * FROM plans WHERE id=$1 AND (owner_account_id IS NULL OR owner_account_id=$2)', [planId, accountId]);
  assert(result.rows[0], 404, 'not_found', 'Plan not found');
  return planResponse(result.rows[0]);
}

export async function updatePlan(accountId: string, planId: string, input: { name?: string; monthlyLimit?: number; maxPerRequest?: number }) {
  const row = await transaction(async client => {
    await client.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE', [accountId]);
    const existing = await client.query('SELECT * FROM plans WHERE id=$1 AND owner_account_id=$2 FOR UPDATE', [planId, accountId]);
    assert(existing.rows[0], 404, 'not_found', 'Custom plan not found');
    const result = await client.query(
      'UPDATE plans SET name=$2,monthly_limit=$3,max_per_request=$4,updated_at=clock_timestamp() WHERE id=$1 RETURNING *',
      [planId, input.name ?? existing.rows[0].name, input.monthlyLimit ?? existing.rows[0].monthly_limit, input.maxPerRequest ?? existing.rows[0].max_per_request],
    );
    return result.rows[0];
  });
  return planResponse(row);
}

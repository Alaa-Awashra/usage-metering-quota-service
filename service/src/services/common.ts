import type { PoolClient } from 'pg';
import { pool } from '../db/client.js';
import { assert } from '../errors.js';

export const numberValue = (value: unknown): number => Number(value);

export function planResponse(row: Record<string, unknown>) {
  return {
    id: row.id,
    scope: row.scope,
    name: row.name,
    monthlyLimit: numberValue(row.monthly_limit),
    maxPerRequest: numberValue(row.max_per_request),
    ownerAccountId: row.owner_account_id,
  };
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function visiblePlan(accountId: string, planId: string, scope: 'user' | 'account') {
  const result = await pool.query(
    'SELECT * FROM plans WHERE id=$1 AND scope=$2 AND (owner_account_id IS NULL OR owner_account_id=$3)',
    [planId, scope, accountId],
  );
  assert(result.rows[0], 404, 'not_found', 'Plan not found');
  return result.rows[0];
}

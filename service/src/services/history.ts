import { pool } from '../db/client.js';
import { numberValue as n } from './common.js';

export async function listRequests(accountId: string, options: { limit: number; cursor: string; userFilter: string | null }) {
  const result = await pool.query(
    `SELECT r.*,u.external_id FROM consume_requests r JOIN users u ON u.id=r.user_id WHERE r.account_id=$1 AND r.id<$2 AND ($3::text IS NULL OR u.external_id=$3) AND r.accepted IS NOT NULL ORDER BY r.id DESC LIMIT $4`,
    [accountId, options.cursor, options.userFilter, options.limit + 1],
  );
  const rows = result.rows.slice(0, options.limit);
  return {
    items: rows.map((row: Record<string, unknown>) => ({
      id: row.id,
      requestId: row.request_id,
      userId: row.external_id,
      units: n(row.units),
      accepted: row.accepted,
      rejection: row.rejected_rule ? { level: row.rejected_level, rule: row.rejected_rule, limit: n(row.rejection_limit) } : null,
      month: row.month instanceof Date ? row.month.toISOString().slice(0, 7) : String(row.month).slice(0, 7),
      createdAt: row.created_at,
      accountMonthlyLimit: n(row.account_monthly_limit),
      accountMaxPerRequest: n(row.account_max_per_request),
      userMonthlyLimit: n(row.user_monthly_limit),
      userMaxPerRequest: n(row.user_max_per_request),
      accountUsedAfter: n(row.account_used_after),
      userUsedAfter: n(row.user_used_after),
    })),
    nextCursor: result.rows.length > options.limit ? String(rows.at(-1)?.id) : null,
  };
}

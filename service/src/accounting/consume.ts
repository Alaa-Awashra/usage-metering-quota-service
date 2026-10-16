import type pg from 'pg';
import { pool } from '../db/client.js';
import { HttpError } from '../errors.js';
import { evaluate, remaining, type Rejection } from '../rules/evaluate.js';

interface Input { accountId: string; externalId: string; units: number; requestId: string; processingTimeForTest?: Date }
interface Row { id:number; user_id:string; units:string; accepted:boolean; rejected_rule:string|null; rejected_level:'user'|'account'|null; rejection_limit:string|null; account_monthly_limit:string; account_max_per_request:string; user_monthly_limit:string; user_max_per_request:string; account_used_after:string; user_used_after:string; month:string }
export interface Decision { requestId:string; accepted:boolean; replayed:boolean; rejection:Rejection|null; account:{used:number;limit:number;remaining:number}; user:{used:number;limit:number;remaining:number} }
function number(v: string|number): number { const n=Number(v); if (!Number.isSafeInteger(n)) throw new Error('Database integer exceeds safe range'); return n; }
function response(row:Row,requestId:string,replayed:boolean):Decision {
  const accountUsed=number(row.account_used_after), userUsed=number(row.user_used_after);
  const accountLimit=number(row.account_monthly_limit), userLimit=number(row.user_monthly_limit);
  return {requestId,accepted:row.accepted,replayed,rejection:row.rejected_rule ? {level:row.rejected_level!,rule:row.rejected_rule as Rejection['rule'],limit:number(row.rejection_limit!)}:null,account:{used:accountUsed,limit:accountLimit,remaining:remaining(accountLimit,accountUsed)},user:{used:userUsed,limit:userLimit,remaining:remaining(userLimit,userUsed)}};
}
async function once(input:Input):Promise<Decision> {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const userResult=await client.query('SELECT id FROM users WHERE account_id=$1 AND external_id=$2',[input.accountId,input.externalId]);
    const userId=userResult.rows[0]?.id as string|undefined;
    if (!userId) throw new HttpError(404,'not_found','User not found');
    // The unique insert waits for a competing uncommitted claim, so only one decision can commit.
    const claim=await client.query('INSERT INTO consume_requests (account_id,user_id,request_id,units) VALUES ($1,$2,$3,$4) ON CONFLICT (account_id,request_id) DO NOTHING RETURNING id',[input.accountId,userId,input.requestId,input.units]);
    if (!claim.rows[0]) {
      const prior=await client.query('SELECT * FROM consume_requests WHERE account_id=$1 AND request_id=$2',[input.accountId,input.requestId]);
      const row=prior.rows[0] as Row|undefined;
      if (!row) throw new Error('Claim conflict without committed decision');
      if (row.user_id!==userId || number(row.units)!==input.units) throw new HttpError(409,'idempotency_conflict','Request ID was used with different inputs');
      await client.query('COMMIT');
      return response(row,input.requestId,true);
    }
    // Shared config lock allows concurrent consumers; plan mutations take FOR UPDATE.
    await client.query('SELECT id FROM accounts WHERE id=$1 FOR SHARE',[input.accountId]);
    const effective=await client.query(`SELECT ap.monthly_limit AS account_monthly_limit, ap.max_per_request AS account_max_per_request,
      up.monthly_limit AS user_monthly_limit, up.max_per_request AS user_max_per_request
      FROM accounts a JOIN plans ap ON ap.id=a.plan_id JOIN users u ON u.account_id=a.id AND u.id=$2 JOIN plans up ON up.id=u.plan_id WHERE a.id=$1`,[input.accountId,userId]);
    const p=effective.rows[0]; if (!p) throw new HttpError(404,'not_found','User not found');
    // Capture time after waiting for configuration. One timestamp selects both counter rows.
    const time=await client.query("WITH t AS MATERIALIZED (SELECT coalesce($1::timestamptz,clock_timestamp()) AS at) SELECT at,date_trunc('month',at AT TIME ZONE 'UTC')::date AS month FROM t",[input.processingTimeForTest??null]);
    const at=time.rows[0].at, month=time.rows[0].month;
    // Always lock user then account counter. Zero-row inserts settle first-month races.
    await client.query('INSERT INTO user_monthly_usage(user_id,month,used) VALUES($1,$2,0) ON CONFLICT DO NOTHING',[userId,month]);
    await client.query('INSERT INTO account_monthly_usage(account_id,month,used) VALUES($1,$2,0) ON CONFLICT DO NOTHING',[input.accountId,month]);
    const ur=await client.query('SELECT used FROM user_monthly_usage WHERE user_id=$1 AND month=$2 FOR UPDATE',[userId,month]);
    const ar=await client.query('SELECT used FROM account_monthly_usage WHERE account_id=$1 AND month=$2 FOR UPDATE',[input.accountId,month]);
    const userUsed=number(ur.rows[0].used), accountUsed=number(ar.rows[0].used);
    const account={monthlyLimit:number(p.account_monthly_limit),maxPerRequest:number(p.account_max_per_request)};
    const user={monthlyLimit:number(p.user_monthly_limit),maxPerRequest:number(p.user_max_per_request)};
    const rejection=evaluate(account,user,accountUsed,userUsed,input.units);
    if (!rejection) {
      await client.query('UPDATE user_monthly_usage SET used=used+$3 WHERE user_id=$1 AND month=$2',[userId,month,input.units]);
      await client.query('UPDATE account_monthly_usage SET used=used+$3 WHERE account_id=$1 AND month=$2',[input.accountId,month,input.units]);
    }
    const final=await client.query(`UPDATE consume_requests SET accepted=$2,rejected_rule=$3,rejected_level=$4,rejection_limit=$5,
      account_monthly_limit=$6,account_max_per_request=$7,user_monthly_limit=$8,user_max_per_request=$9,
      account_used_after=$10,user_used_after=$11,month=$12,created_at=$13 WHERE id=$1 RETURNING *`,[
      claim.rows[0].id,!rejection,rejection?.rule??null,rejection?.level??null,rejection?.limit??null,
      account.monthlyLimit,account.maxPerRequest,user.monthlyLimit,user.maxPerRequest,
      accountUsed+(rejection?0:input.units),userUsed+(rejection?0:input.units),month,at]);
    await client.query('COMMIT');
    return response(final.rows[0] as Row,input.requestId,false);
  } catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
  finally { client.release(); }
}
export async function consume(input:Input):Promise<Decision> {
  for(let attempt=0;attempt<3;attempt++) {
    try { return await once(input); }
    catch(error) {
      const code=(error as pg.DatabaseError).code;
      if ((code==='40P01'||code==='40001') && attempt<2) { await new Promise(r=>setTimeout(r,10*(attempt+1))); continue; }
      throw error;
    }
  }
  throw new Error('Unreachable transaction retry state');
}

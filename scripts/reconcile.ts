import pg from 'pg';
const url=process.env.DATABASE_URL;
if(!url) throw new Error('DATABASE_URL is required');
const pool=new pg.Pool({connectionString:url,max:2});
try {
  const accounts=await pool.query(`WITH expected AS (
    SELECT account_id,month,sum(units) AS total FROM consume_requests WHERE accepted=true GROUP BY account_id,month
  ) SELECT coalesce(c.account_id,e.account_id) AS id,coalesce(c.month,e.month) AS month,c.used,e.total
    FROM account_monthly_usage c FULL OUTER JOIN expected e ON e.account_id=c.account_id AND e.month=c.month
    WHERE coalesce(c.used,0)<>coalesce(e.total,0)`);
  const users=await pool.query(`WITH expected AS (
    SELECT user_id,month,sum(units) AS total FROM consume_requests WHERE accepted=true GROUP BY user_id,month
  ) SELECT coalesce(c.user_id,e.user_id) AS id,coalesce(c.month,e.month) AS month,c.used,e.total
    FROM user_monthly_usage c FULL OUTER JOIN expected e ON e.user_id=c.user_id AND e.month=c.month
    WHERE coalesce(c.used,0)<>coalesce(e.total,0)`);
  const pending=await pool.query('SELECT count(*)::int AS n FROM consume_requests WHERE accepted IS NULL');
  const result={accountMismatches:accounts.rows,userMismatches:users.rows,committedPending:Number(pending.rows[0].n)};
  console.log(JSON.stringify(result));
  if(accounts.rowCount || users.rowCount || result.committedPending) process.exitCode=1;
} finally {await pool.end();}

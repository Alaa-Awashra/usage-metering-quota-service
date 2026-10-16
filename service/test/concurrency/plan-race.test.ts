import { test } from 'node:test';
import { strictEqual } from 'node:assert';
import { setup } from '../helpers/db.js';
test('first counter insert observes a limit reduced while waiting on account configuration',async()=>{
  const t=await setup();
  try {
    const a=await t.account();
    const plans=(await t.call('/v1/plans','GET',undefined,a.apiKey)).data as any[];
    await t.call('/v1/users','POST',{externalId:'u',planId:plans.find(p=>p.name==='Basic').id},a.apiKey);
    const p=await t.call('/v1/plans','POST',{scope:'account',name:'Changing',monthlyLimit:100,maxPerRequest:100},a.apiKey);
    await t.call('/v1/account/plan','PUT',{planId:p.data.id},a.apiKey);
    const c=await t.pool.connect();
    try {
      await c.query('BEGIN'); await c.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE',[a.id]);
      const pending=t.call('/v1/consume','POST',{userId:'u',units:5,requestId:'boundary'},a.apiKey);
      let waiting=false;
      for(let i=0;i<100;i++) { const q=await t.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'"); if(q.rows[0].n>0){waiting=true;break;} await new Promise(r=>setTimeout(r,20)); }
      strictEqual(waiting,true,'consumer must be blocked on the configuration lock');
      await c.query('UPDATE plans SET monthly_limit=0 WHERE id=$1',[p.data.id]);
      await c.query('COMMIT');
      const decision=await pending;
      strictEqual(decision.data.accepted,false); strictEqual(decision.data.rejection.level,'account');
      strictEqual((await t.call('/v1/usage','GET',undefined,a.apiKey)).data.used,0);
    } finally { await c.query('ROLLBACK').catch(()=>{}); c.release(); }
  } finally { await t.close(); }
});

test('user plan assignment takes effect before a waiting consumption is admitted', async () => {
  const t = await setup();
  try {
    const account = await t.account();
    const plans = (await t.call('/v1/plans', 'GET', undefined, account.apiKey)).data as any[];
    const basic = plans.find(plan => plan.name === 'Basic');
    const zero = await t.call('/v1/plans', 'POST', {
      scope: 'user', name: 'No monthly units', monthlyLimit: 0, maxPerRequest: 20,
    }, account.apiKey);
    strictEqual((await t.call('/v1/users', 'POST', { externalId: 'u', planId: basic.id }, account.apiKey)).status, 201);

    const holder = await t.pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE', [account.id]);
      const pending = t.call('/v1/consume', 'POST', { userId: 'u', units: 1, requestId: 'waiting' }, account.apiKey);
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const locks = await t.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'");
        if (locks.rows[0].n > 0) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      strictEqual(waiting, true, 'consumer must wait on configuration');
      await holder.query('UPDATE users SET plan_id=$1 WHERE account_id=$2 AND external_id=$3', [zero.data.id, account.id, 'u']);
      await holder.query('COMMIT');

      const decision = await pending;
      strictEqual(decision.data.accepted, false);
      strictEqual(decision.data.rejection.level, 'user');
      strictEqual(decision.data.rejection.rule, 'monthly_allowance');
      strictEqual((await t.call('/v1/users/u/usage', 'GET', undefined, account.apiKey)).data.used, 0);
      strictEqual((await t.call('/v1/users/u/plan', 'PUT', { planId: basic.id }, account.apiKey)).status, 200);
      strictEqual((await t.call('/v1/consume', 'POST', { userId: 'u', units: 1, requestId: 'new' }, account.apiKey)).data.accepted, true);
    } finally {
      await holder.query('ROLLBACK').catch(() => {});
      holder.release();
    }
  } finally {
    await t.close();
  }
});

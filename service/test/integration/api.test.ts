import { test } from 'node:test';
import { strictEqual, deepStrictEqual, rejects } from 'node:assert';
import { setup } from '../helpers/db.js';
test('consumption, replay, plan changes, history, and isolation',async()=>{
  const t=await setup();
  try {
    const a=await t.account(), b=await t.account();
    const plans=(await t.call('/v1/plans','GET',undefined,a.apiKey)).data as any[];
    const basic=plans.find(p=>p.name==='Basic');
    strictEqual((await t.call('/v1/users','POST',{externalId:'same',planId:basic.id},a.apiKey)).status,201);
    strictEqual((await t.call('/v1/users','POST',{externalId:'other',planId:basic.id},a.apiKey)).status,201);
    strictEqual((await t.call('/v1/users','POST',{externalId:'same',planId:basic.id},b.apiKey)).status,201);
    await rejects(t.pool.query('UPDATE users SET plan_id=$1 WHERE account_id=$2 AND external_id=$3',[plans.find(p=>p.name==='Starter').id,a.id,'same']),{code:'23514'});
    const first=await t.call('/v1/consume','POST',{userId:'same',units:10,requestId:'first'},a.apiKey); strictEqual(first.data.accepted,true);
    const replay=await t.call('/v1/consume','POST',{userId:'same',units:10,requestId:'first'},a.apiKey); strictEqual(replay.data.replayed,true); deepStrictEqual(replay.data.account,first.data.account);
    strictEqual((await t.call('/v1/consume','POST',{userId:'same',units:11,requestId:'first'},a.apiKey)).status,409);
    strictEqual((await t.call('/v1/consume','POST',{userId:'other',units:10,requestId:'first'},a.apiKey)).status,409);
    const reject=await t.call('/v1/consume','POST',{userId:'same',units:21,requestId:'reject'},a.apiKey); strictEqual(reject.data.rejection.rule,'max_per_request');
    const tightAccount=await t.call('/v1/plans','POST',{scope:'account',name:'Small request',monthlyLimit:100,maxPerRequest:10},a.apiKey);
    strictEqual((await t.call('/v1/account/plan','PUT',{planId:tightAccount.data.id},a.apiKey)).status,200);
    const accountMax=await t.call('/v1/consume','POST',{userId:'same',units:11,requestId:'account-max'},a.apiKey);
    strictEqual(accountMax.data.rejection.level,'account'); strictEqual(accountMax.data.rejection.rule,'max_per_request');
    strictEqual((await t.call('/v1/account/plan','PUT',{planId:plans.find(p=>p.name==='Starter').id},a.apiKey)).status,200);
    const custom=await t.call('/v1/plans','POST',{scope:'user',name:'Tiny',monthlyLimit:10,maxPerRequest:10},a.apiKey); strictEqual(custom.status,201);
    strictEqual((await t.call(`/v1/plans/${custom.data.id}`,'GET',undefined,b.apiKey)).status,404);
    strictEqual((await t.call(`/v1/plans/${custom.data.id}`,'PATCH',{monthlyLimit:999},b.apiKey)).status,404);
    strictEqual((await t.call(`/v1/plans/${basic.id}`,'PATCH',{monthlyLimit:999},a.apiKey)).status,404);
    strictEqual((await t.call(`/v1/users/same/plan`,'PUT',{planId:custom.data.id},b.apiKey)).status,404);
    strictEqual((await t.call('/v1/users/same/plan','PUT',{planId:custom.data.id},a.apiKey)).status,200);
    const full=await t.call('/v1/consume','POST',{userId:'same',units:1,requestId:'full'},a.apiKey); strictEqual(full.data.rejection.rule,'monthly_allowance');
    strictEqual((await t.call(`/v1/plans/${custom.data.id}`,'PATCH',{monthlyLimit:20},a.apiKey)).status,200);
    const rejectedReplay=await t.call('/v1/consume','POST',{userId:'same',units:21,requestId:'reject'},a.apiKey);
    strictEqual(rejectedReplay.data.replayed,true); deepStrictEqual(rejectedReplay.data.rejection,reject.data.rejection);
    strictEqual((await t.call('/v1/consume','POST',{userId:'same',units:1,requestId:'after'},a.apiKey)).data.accepted,true);
    strictEqual((await t.call('/v1/usage','GET',undefined,a.apiKey)).data.used,11);
    strictEqual((await t.call('/v1/usage','GET',undefined,b.apiKey)).data.used,0);
    strictEqual((await t.call('/v1/requests','GET',undefined,b.apiKey)).data.items.length,0);
    strictEqual((await t.call('/v1/requests?limit=2','GET',undefined,a.apiKey)).data.items.length,2);
    const reconcile=await t.pool.query(`SELECT coalesce((SELECT used FROM account_monthly_usage WHERE account_id=$1 AND month=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date),0) AS used,coalesce((SELECT sum(units) FROM consume_requests WHERE account_id=$1 AND accepted AND month=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date),0) AS total`,[a.id]);
    strictEqual(Number(reconcile.rows[0].used),Number(reconcile.rows[0].total));
  } finally { await t.close(); }
});

test('account monthly rejection leaves the other user untouched and replays after a limit change', async () => {
  const t = await setup();
  try {
    const account = await t.account();
    const plans = (await t.call('/v1/plans', 'GET', undefined, account.apiKey)).data as any[];
    const basic = plans.find(plan => plan.name === 'Basic');
    const limited = await t.call('/v1/plans', 'POST', {
      scope: 'account', name: 'Shared three', monthlyLimit: 3, maxPerRequest: 10,
    }, account.apiKey);
    strictEqual((await t.call('/v1/account/plan', 'PUT', { planId: limited.data.id }, account.apiKey)).status, 200);
    for (const externalId of ['one', 'two']) {
      strictEqual((await t.call('/v1/users', 'POST', { externalId, planId: basic.id }, account.apiKey)).status, 201);
    }

    const first = await t.call('/v1/consume', 'POST', { userId: 'one', units: 2, requestId: 'first' }, account.apiKey);
    const blocked = await t.call('/v1/consume', 'POST', { userId: 'two', units: 2, requestId: 'blocked' }, account.apiKey);
    strictEqual(first.data.accepted, true);
    deepStrictEqual(blocked.data.rejection, { level: 'account', rule: 'monthly_allowance', limit: 3 });
    strictEqual((await t.call('/v1/usage', 'GET', undefined, account.apiKey)).data.used, 2);
    strictEqual((await t.call('/v1/users/two/usage', 'GET', undefined, account.apiKey)).data.used, 0);

    strictEqual((await t.call(`/v1/plans/${limited.data.id}`, 'PATCH', { monthlyLimit: 4 }, account.apiKey)).status, 200);
    const replay = await t.call('/v1/consume', 'POST', { userId: 'two', units: 2, requestId: 'blocked' }, account.apiKey);
    strictEqual(replay.data.replayed, true);
    deepStrictEqual(replay.data.rejection, blocked.data.rejection);
    strictEqual((await t.call('/v1/consume', 'POST', { userId: 'two', units: 2, requestId: 'new' }, account.apiKey)).data.accepted, true);
    strictEqual((await t.call('/v1/usage', 'GET', undefined, account.apiKey)).data.used, 4);

    strictEqual((await t.call(`/v1/plans/${limited.data.id}`, 'PATCH', { monthlyLimit: 1 }, account.apiKey)).status, 200);
    strictEqual((await t.call('/v1/usage', 'GET', undefined, account.apiKey)).data.remaining, 0);
    const blockedAgain = await t.call('/v1/consume', 'POST', { userId: 'two', units: 1, requestId: 'after-reduction' }, account.apiKey);
    strictEqual(blockedAgain.data.rejection.level, 'account');

    const totals = await t.pool.query(`SELECT
      (SELECT used FROM account_monthly_usage WHERE account_id=$1 AND month=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date) AS used,
      (SELECT sum(units) FROM consume_requests WHERE account_id=$1 AND accepted AND month=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date) AS accepted`, [account.id]);
    strictEqual(Number(totals.rows[0].used), Number(totals.rows[0].accepted));
    strictEqual(Number(totals.rows[0].used), 4);
  } finally {
    await t.close();
  }
});

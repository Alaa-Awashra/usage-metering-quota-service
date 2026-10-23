import { test } from 'node:test';
import { strictEqual } from 'node:assert';
import { setup } from '../helpers/db.js';
test('UTC month selection, historical counters, and replay after boundary',async()=>{
  const t=await setup();
  try {
    const a=await t.account(); const plans=(await t.call('/v1/plans','GET',undefined,a.apiKey)).data as any[];
    await t.call('/v1/users','POST',{externalId:'u',planId:plans.find(p=>p.name==='Basic').id},a.apiKey);
    const {consume}=await import('../../src/accounting/consume.js');
    const before=await consume({accountId:a.id,externalId:'u',units:2,requestId:'before-midnight',processingTimeForTest:new Date('2026-09-30T23:59:59Z')});
    const after=await consume({accountId:a.id,externalId:'u',units:3,requestId:'after-midnight',processingTimeForTest:new Date('2026-10-01T00:00:00Z')});
    strictEqual(before.user.used,2); strictEqual(after.user.used,3);
    const replay=await consume({accountId:a.id,externalId:'u',units:2,requestId:'before-midnight',processingTimeForTest:new Date('2026-10-01T00:00:10Z')});
    strictEqual(replay.replayed,true); strictEqual(replay.user.used,2);
    strictEqual((await t.call('/v1/usage?month=2026-09','GET',undefined,a.apiKey)).data.used,2);
    strictEqual((await t.call('/v1/usage?month=2026-10','GET',undefined,a.apiKey)).data.used,3);
  } finally { await t.close(); }
});


test('request history preserves UTC calendar month in Asia/Hebron timezone', async () => {
  const t = await setup();
  const initialTz = process.env.TZ;
  try {
    const account = await t.account();
    const plans = (await t.call('/v1/plans', 'GET', undefined, account.apiKey)).data as any[];
    strictEqual((await t.call('/v1/users', 'POST', {
      externalId: 'boundary-user', planId: plans.find(plan => plan.name === 'Basic').id,
    }, account.apiKey)).status, 201);
    const { consume } = await import('../../src/accounting/consume.js');
    await consume({accountId: account.id, externalId: 'boundary-user', units: 2,
      requestId: 'september-end', processingTimeForTest: new Date('2026-09-30T23:59:59.999Z')});
    await consume({accountId: account.id, externalId: 'boundary-user', units: 3,
      requestId: 'october-start', processingTimeForTest: new Date('2026-10-01T00:00:00.000Z')});
    process.env.TZ = 'Asia/Hebron';
    const response = await t.call('/v1/requests?limit=10', 'GET', undefined, account.apiKey);
    strictEqual(response.status, 200);
    const history = response.data.items as any[];
    strictEqual(history.find(row => row.requestId === 'september-end')?.month, '2026-09');
    strictEqual(history.find(row => row.requestId === 'october-start')?.month, '2026-10');
    const stored = await t.pool.query(
      'SELECT request_id, month::text AS calendar_month FROM consume_requests WHERE account_id=$1',
      [account.id],
    );
    strictEqual(stored.rows.find(row => row.request_id === 'september-end')?.calendar_month, '2026-09-01');
    strictEqual(stored.rows.find(row => row.request_id === 'october-start')?.calendar_month, '2026-10-01');
    strictEqual((await t.call('/v1/usage?month=2026-09', 'GET', undefined, account.apiKey)).data.used, 2);
    strictEqual((await t.call('/v1/usage?month=2026-10', 'GET', undefined, account.apiKey)).data.used, 3);
  } finally {
    if (initialTz === undefined) delete process.env.TZ;
    else process.env.TZ = initialTz;
    await t.close();
  }
});

test('usage uses database UTC default month and returns HTTP 400 for invalid month inputs', async () => {
  const t = await setup();
  try {
    const account = await t.account();
    const plans = (await t.call('/v1/plans', 'GET', undefined, account.apiKey)).data as any[];
    strictEqual((await t.call('/v1/users', 'POST', {
      externalId: 'dated-user', planId: plans.find(plan => plan.name === 'Basic').id,
    }, account.apiKey)).status, 201);
    const period = await t.pool.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM') AS current_month");
    const expectedMonth = period.rows[0].current_month;
    const accountUsage = await t.call('/v1/usage', 'GET', undefined, account.apiKey);
    const userUsage = await t.call('/v1/users/dated-user/usage', 'GET', undefined, account.apiKey);
    strictEqual(accountUsage.status, 200);
    strictEqual(userUsage.status, 200);
    strictEqual(accountUsage.data.month, expectedMonth);
    strictEqual(userUsage.data.month, expectedMonth);
    for (const invalid of ['0000-01', '2026-00', '2026-13', '2026-1', '2026-10-01']) {
      const accountBad = await t.call(`/v1/usage?month=${invalid}`, 'GET', undefined, account.apiKey);
      const userBad = await t.call(`/v1/users/dated-user/usage?month=${invalid}`, 'GET', undefined, account.apiKey);
      strictEqual(accountBad.status, 400, `account invalid month: ${invalid}`);
      strictEqual(userBad.status, 400, `user invalid month: ${invalid}`);
    }
  } finally { await t.close(); }
});

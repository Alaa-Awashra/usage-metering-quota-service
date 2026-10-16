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

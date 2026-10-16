import { test } from 'node:test';
import { strictEqual } from 'node:assert';
import { setup } from '../helpers/db.js';
test('100 concurrent requests cannot exceed shared account quota',async()=>{
  const t=await setup();
  try {
    const a=await t.account();
    const plans=(await t.call('/v1/plans','GET',undefined,a.apiKey)).data as any[];
    const basic=plans.find(p=>p.name==='Basic');
    const custom=await t.call('/v1/plans','POST',{scope:'account',name:'Twenty',monthlyLimit:20,maxPerRequest:20},a.apiKey);
    strictEqual((await t.call('/v1/account/plan','PUT',{planId:custom.data.id},a.apiKey)).status,200);
    for(let i=0;i<5;i++) strictEqual((await t.call('/v1/users','POST',{externalId:`u${i}`,planId:basic.id},a.apiKey)).status,201);
    const results=await Promise.all(Array.from({length:100},(_,i)=>t.call('/v1/consume','POST',{userId:`u${i%5}`,units:1,requestId:`r${i}`},a.apiKey)));
    strictEqual(results.filter(r=>r.data.accepted).length,20);
    strictEqual(results.filter(r=>r.data.accepted===false).length,80);
    strictEqual((await t.call('/v1/usage','GET',undefined,a.apiKey)).data.used,20);
    const totals=await t.pool.query(`SELECT (SELECT used FROM account_monthly_usage WHERE account_id=$1 AND month=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date) used,(SELECT sum(units) FROM consume_requests WHERE account_id=$1 AND accepted) accepted`,[a.id]);
    strictEqual(Number(totals.rows[0].used),Number(totals.rows[0].accepted));
  } finally { await t.close(); }
});
test('simultaneous identical request ID commits once',async()=>{
  const t=await setup();
  try { const a=await t.account(); const plans=(await t.call('/v1/plans','GET',undefined,a.apiKey)).data as any[]; await t.call('/v1/users','POST',{externalId:'u',planId:plans.find(p=>p.name==='Basic').id},a.apiKey);
    const r=await Promise.all(Array.from({length:20},()=>t.call('/v1/consume','POST',{userId:'u',units:1,requestId:'same'},a.apiKey)));
    strictEqual(r.filter(x=>x.data.replayed===false).length,1); strictEqual((await t.call('/v1/usage','GET',undefined,a.apiKey)).data.used,1);
  } finally { await t.close(); }
});

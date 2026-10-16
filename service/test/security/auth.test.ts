import { test } from 'node:test';
import { strictEqual } from 'node:assert';
import { setup } from '../helpers/db.js';
test('admin and account credentials are separate',async()=>{
  const t=await setup();
  try {
    strictEqual((await t.call('/admin/accounts','POST',{name:'x',planName:'Starter'})).status,401);
    strictEqual((await fetch(`${t.base}/admin/accounts`, { method: 'POST', headers: { 'X-Admin-Token': 'wrong', 'Content-Type': 'application/json' }, body: JSON.stringify({name:'x',planName:'Starter'}) })).status,401);
    strictEqual((await t.call('/v1/account')).status,401);
    strictEqual((await t.call('/v1/account','GET',undefined,'wrong')).status,401);
    for (const authorization of ['', 'Bearer wrong', 'ApiKey ', 'ApiKey mq_wrong']) {
      strictEqual((await fetch(`${t.base}/v1/account`, { headers: { Authorization: authorization } })).status, 401);
    }
    const a=await t.account();
    const ordinary=await t.call('/v1/account','GET',undefined,a.apiKey);
    strictEqual(ordinary.status,200);
    strictEqual(JSON.stringify(ordinary.data).includes(a.apiKey),false);
    const keys = await t.pool.query('SELECT key_hash,key_prefix FROM api_keys WHERE account_id=$1', [a.id]);
    strictEqual(keys.rows.length,1);
    strictEqual(keys.rows[0].key_hash === a.apiKey,false);
    strictEqual(keys.rows[0].key_prefix === a.apiKey,false);
  }
  finally { await t.close(); }
});

import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { setup } from '../helpers/db.js';

// Tests real HTTP handlers and real PostgreSQL. Requires TEST_DATABASE_URL ending in _test.
test('all protected API groups reject missing credentials', async () => {
  const t = await setup();
  try {
    const cases: Array<[string, string, unknown?]> = [
      ['/v1/account', 'GET'],
      ['/v1/plans', 'GET'],
      ['/v1/plans', 'POST', { scope: 'user', name: 'Unauthorized', monthlyLimit: 5, maxPerRequest: 1 }],
      ['/v1/users', 'POST', { externalId: 'x', planId: crypto.randomUUID() }],
      ['/v1/users/x', 'GET'],
      ['/v1/consume', 'POST', { userId: 'x', units: 1, requestId: 'unauthorized' }],
      ['/v1/usage', 'GET'],
      ['/v1/requests', 'GET'],
    ];
    for (const [path, method, body] of cases) {
      const actual = await t.call(path, method, body);
      strictEqual(actual.status, 401, `${method} ${path} must reject missing API key`);
    }
    strictEqual((await t.call('/admin/accounts', 'POST', { name: 'unauthorized', planName: 'Starter' })).status, 401);
  } finally { await t.close(); }
});

test('SQL injection strings remain data in plan names and user IDs', async () => {
  const t = await setup();
  try {
    const a = await t.account();
    const maliciousPlan = "plan'); DROP TABLE plans; --";
    const maliciousUser = "user' OR '1'='1";
    const p = await t.call('/v1/plans', 'POST', {
      name: maliciousPlan, scope: 'user', monthlyLimit: 50, maxPerRequest: 10,
    }, a.apiKey);
    strictEqual(p.status, 201, 'Quoted input must remain a normal plan name');
    strictEqual(p.data.name, maliciousPlan);
    strictEqual((await t.call('/v1/users', 'POST', { externalId: maliciousUser, planId: p.data.id }, a.apiKey)).status, 201);
    const usage = await t.call('/v1/consume', 'POST', {
      userId: maliciousUser, units: 3, requestId: 'quoted-value-test',
    }, a.apiKey);
    strictEqual(usage.status, 200);
    strictEqual(usage.data.accepted, true);
    const stillThere = await t.pool.query("SELECT to_regclass('public.plans') AS plans, to_regclass('public.users') AS users");
    ok(stillThere.rows[0].plans && stillThere.rows[0].users, 'Database tables must still exist');
    strictEqual((await t.call('/v1/account', 'GET', undefined, a.apiKey)).status, 200);
  } finally { await t.close(); }
});

test('account isolation survives attempted account ID spoofing and cross-tenant plan access', async () => {
  const t = await setup();
  try {
    const a = await t.account();
    const b = await t.account();
    const plans = (await t.call('/v1/plans', 'GET', undefined, a.apiKey)).data as Array<{id: string;name: string}>;
    const basic = plans.find(x => x.name === 'Basic');
    ok(basic);
    const custom = await t.call('/v1/plans', 'POST', {
      name: `A-private-${crypto.randomUUID()}`, scope: 'user', monthlyLimit: 10, maxPerRequest: 5,
    }, a.apiKey);
    strictEqual(custom.status, 201);
    strictEqual((await t.call('/v1/users', 'POST', { externalId: 'a-only', planId: custom.data.id }, a.apiKey)).status, 201);
    strictEqual((await t.call('/v1/users/a-only', 'GET', undefined, b.apiKey)).status, 404);
    strictEqual((await t.call(`/v1/plans/${custom.data.id}`, 'GET', undefined, b.apiKey)).status, 404);
    strictEqual((await t.call('/v1/users', 'POST', { externalId: 'b-only', planId: custom.data.id }, b.apiKey)).status, 404);
    strictEqual((await t.call('/v1/users', 'POST', { externalId: 'b-only', planId: basic.id }, b.apiKey)).status, 201);
    const spoof = await t.call('/v1/consume', 'POST', {
      accountId: a.id, userId: 'b-only', units: 2, requestId: `spoof-${crypto.randomUUID()}`,
    }, b.apiKey);
    strictEqual(spoof.status, 200);
    strictEqual(spoof.data.accepted, true);
    const aUsage = await t.call('/v1/usage', 'GET', undefined, a.apiKey);
    const bUsage = await t.call('/v1/usage', 'GET', undefined, b.apiKey);
    strictEqual(aUsage.data.used, 0);
    strictEqual(bUsage.data.used, 2);
    const bHistory = await t.call('/v1/requests', 'GET', undefined, b.apiKey);
    strictEqual(bHistory.status, 200);
    strictEqual(bHistory.data.items.length, 1);
    strictEqual(bHistory.data.items[0].userId, 'b-only');
  } finally { await t.close(); }
});

test('malformed JSON, large bodies, and error responses do not disclose internals', async () => {
  const t = await setup();
  try {
    const a = await t.account();
    const bad = await fetch(`${t.base}/v1/consume`, {
      method: 'POST',
      headers: { Authorization: `ApiKey ${a.apiKey}`, 'Content-Type': 'application/json' },
      body: '{not JSON',
    });
    strictEqual(bad.status, 400);
    const body = await bad.text();
    ok(!body.includes(a.apiKey));
    ok(!body.includes('node_modules'));
    ok(!body.includes('stack'));
    strictEqual(bad.headers.get('x-powered-by'), null);

    const big = await fetch(`${t.base}/v1/consume`, {
      method: 'POST',
      headers: { Authorization: `ApiKey ${a.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'A'.repeat(20_000), units: 1, requestId: 'oversize' }),
    });
    strictEqual(big.status, 413);
    const tooLarge = await big.text();
    ok(!tooLarge.includes(a.apiKey));
    ok(!tooLarge.includes('node_modules'));

    const plans = await t.call('/v1/plans', 'GET', undefined, a.apiKey);
    strictEqual(plans.status, 200);
    ok(!JSON.stringify(plans.data).includes(a.apiKey), 'API key must not leak in read responses');
  } finally { await t.close(); }
});

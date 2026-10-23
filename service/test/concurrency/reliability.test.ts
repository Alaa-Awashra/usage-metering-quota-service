import { test } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { setup } from '../helpers/db.js';

/** All these tests must run against the isolated database named *_test. */

test('concurrent identical request IDs with conflicting users and amounts have exactly one winner', async () => {
  const t = await setup();
  try {
    const account = await t.account();
    const plans = (await t.call('/v1/plans', 'GET', undefined, account.apiKey)).data as any[];
    const basic = plans.find(plan => plan.name === 'Basic');
    for (const externalId of ['alice', 'bob']) {
      strictEqual((await t.call('/v1/users', 'POST', { externalId, planId: basic.id }, account.apiKey)).status, 201);
    }

    const payloads = Array.from({ length: 32 }, (_, index) => ({
      userId: index % 2 === 0 ? 'alice' : 'bob',
      units: index % 4 < 2 ? 1 : 2,
      requestId: 'one-logical-operation',
    }));
    const outcomes = await Promise.all(payloads.map(body => t.call('/v1/consume', 'POST', body, account.apiKey)));
    const firstDecisions = outcomes.map((outcome, index) => ({ ...outcome, body: payloads[index] }))
      .filter(outcome => outcome.status === 200 && outcome.data.replayed === false);
    strictEqual(firstDecisions.length, 1, 'exactly one request may create the committed decision');
    const winner = firstDecisions[0].body;
    const winnerIndex = outcomes.findIndex(outcome => outcome.status === 200 && outcome.data.replayed === false);

    for (let index = 0; index < outcomes.length; index++) {
      const outcome = outcomes[index];
      const body = payloads[index];
      const identical = body.userId === winner.userId && body.units === winner.units;
      strictEqual(outcome.status, identical ? 200 : 409, `request ${index}: matching input should replay; conflicting input should be 409`);
      if (identical) {
        strictEqual(outcome.data.accepted, true);
        strictEqual(outcome.data.replayed, index !== winnerIndex);
      }
    }

    const stored = await t.pool.query(`SELECT r.request_id, r.units, r.accepted, u.external_id
      FROM consume_requests r JOIN users u ON u.id=r.user_id
      WHERE r.account_id=$1 AND r.request_id=$2`, [account.id, 'one-logical-operation']);
    strictEqual(stored.rows.length, 1);
    strictEqual(stored.rows[0].external_id, winner.userId);
    strictEqual(Number(stored.rows[0].units), winner.units);
    strictEqual(stored.rows[0].accepted, true);
    strictEqual((await t.call('/v1/usage', 'GET', undefined, account.apiKey)).data.used, winner.units);
    strictEqual((await t.call(`/v1/users/${winner.userId}/usage`, 'GET', undefined, account.apiKey)).data.used, winner.units);
    const other = winner.userId === 'alice' ? 'bob' : 'alice';
    strictEqual((await t.call(`/v1/users/${other}/usage`, 'GET', undefined, account.apiKey)).data.used, 0);
  } finally { await t.close(); }
});

test('many requests obey a plan reduction during a concurrent request burst', async () => {
  const t = await setup();
  try {
    const account = await t.account();
    const plans = (await t.call('/v1/plans', 'GET', undefined, account.apiKey)).data as any[];
    const basic = plans.find(plan => plan.name === 'Basic');
    const custom = await t.call('/v1/plans', 'POST', {
      scope: 'account', name: 'Reducible under load', monthlyLimit: 100, maxPerRequest: 20,
    }, account.apiKey);
    strictEqual(custom.status, 201);
    strictEqual((await t.call('/v1/account/plan', 'PUT', { planId: custom.data.id }, account.apiKey)).status, 200);
    for (let index = 0; index < 5; index++) {
      strictEqual((await t.call('/v1/users', 'POST', {
        externalId: `u${index}`, planId: basic.id,
      }, account.apiKey)).status, 201);
    }

    const holder = await t.pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE', [account.id]);
      const pending = Promise.all(Array.from({ length: 40 }, (_, index) => t.call('/v1/consume', 'POST', {
        userId: `u${index % 5}`, units: 1, requestId: `reduce-${index}`,
      }, account.apiKey)));
      await holder.query('UPDATE plans SET monthly_limit=10 WHERE id=$1', [custom.data.id]);
      await holder.query('COMMIT');

      const results = await pending;
      strictEqual(results.filter(result => result.status !== 200).length, 0, 'no unexpected HTTP errors');
      const accepted = results.filter(result => result.data.accepted === true);
      const rejected = results.filter(result => result.data.accepted === false);
      strictEqual(accepted.length, 10);
      strictEqual(rejected.length, 30);
      for (const result of rejected) {
        deepStrictEqual(result.data.rejection, { level: 'account', rule: 'monthly_allowance', limit: 10 });
        strictEqual(result.data.account.limit, 10);
      }
      strictEqual((await t.call('/v1/usage', 'GET', undefined, account.apiKey)).data.used, 10);
      const count = await t.pool.query(`SELECT count(*)::int AS requests,
        coalesce(sum(units) FILTER (WHERE accepted),0)::bigint AS accepted_units
        FROM consume_requests WHERE account_id=$1`, [account.id]);
      strictEqual(count.rows[0].requests, 40);
      strictEqual(Number(count.rows[0].accepted_units), 10);
    } finally {
      await holder.query('ROLLBACK').catch(() => {});
      holder.release();
    }
  } finally { await t.close(); }
});

test('database failure at final decision write rolls back both counters and releases the idempotency claim', async () => {
  const t = await setup();
  const trigger = 'test_fail_final_decision_trigger';
  const functionName = 'test_fail_final_decision_function';
  let functionInstalled = false;
  let triggerInstalled = false;
  try {
    const account = await t.account();
    const plans = (await t.call('/v1/plans', 'GET', undefined, account.apiKey)).data as any[];
    const basic = plans.find(plan => plan.name === 'Basic');
    strictEqual((await t.call('/v1/users', 'POST', { externalId: 'rollback-user', planId: basic.id }, account.apiKey)).status, 201);

    // Recover safely if a previous interrupted test left behind its temporary trigger.
    await t.pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON consume_requests`);
    await t.pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    // Test-only fault injection in the dedicated *_test database, not in production source or migrations.
    await t.pool.query(`CREATE OR REPLACE FUNCTION ${functionName}() RETURNS trigger AS $$
      BEGIN
        IF NEW.request_id LIKE 'rollback-injection-%' THEN
          RAISE EXCEPTION 'test-only simulated database write failure' USING ERRCODE='P0001';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    functionInstalled = true;
    await t.pool.query(`CREATE TRIGGER ${trigger}
      BEFORE UPDATE ON consume_requests FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
    triggerInstalled = true;

    const request = { userId: 'rollback-user', units: 3, requestId: 'rollback-injection-should-retry' };
    const failure = await t.call('/v1/consume', 'POST', request, account.apiKey);
    strictEqual(failure.status, 500, 'injected database failure must not be reported as accepted');
    strictEqual((await t.call('/v1/usage', 'GET', undefined, account.apiKey)).data.used, 0);
    strictEqual((await t.call('/v1/users/rollback-user/usage', 'GET', undefined, account.apiKey)).data.used, 0);
    const unfinished = await t.pool.query('SELECT count(*)::int AS n FROM consume_requests WHERE account_id=$1 AND request_id=$2', [account.id, request.requestId]);
    strictEqual(unfinished.rows[0].n, 0, 'no claim or incomplete final decision may remain after rollback');

    await t.pool.query(`DROP TRIGGER ${trigger} ON consume_requests`);
    triggerInstalled = false;
    await t.pool.query(`DROP FUNCTION ${functionName}()`);
    functionInstalled = false;
    const retry = await t.call('/v1/consume', 'POST', request, account.apiKey);
    strictEqual(retry.status, 200);
    strictEqual(retry.data.accepted, true);
    strictEqual(retry.data.replayed, false);
    strictEqual((await t.call('/v1/usage', 'GET', undefined, account.apiKey)).data.used, 3);
    const replay = await t.call('/v1/consume', 'POST', request, account.apiKey);
    strictEqual(replay.data.replayed, true);
    strictEqual((await t.call('/v1/usage', 'GET', undefined, account.apiKey)).data.used, 3);
  } finally {
    if (triggerInstalled) await t.pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON consume_requests`).catch(() => {});
    if (functionInstalled) await t.pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`).catch(() => {});
    await t.close();
  }
});

test('retry after a lost response replays the old snapshot even after the plan is reduced', async () => {
  const t = await setup();
  try {
    const account = await t.account();
    const plans = (await t.call('/v1/plans', 'GET', undefined, account.apiKey)).data as any[];
    const basic = plans.find(plan => plan.name === 'Basic');
    strictEqual((await t.call('/v1/users', 'POST', { externalId: 'lost-reply', planId: basic.id }, account.apiKey)).status, 201);
    const plan = await t.call('/v1/plans', 'POST', {
      scope: 'account', name: 'Reduced after commit', monthlyLimit: 20, maxPerRequest: 10,
    }, account.apiKey);
    strictEqual(plan.status, 201);
    strictEqual((await t.call('/v1/account/plan', 'PUT', { planId: plan.data.id }, account.apiKey)).status, 200);

    // Simulate an application that successfully committed a request but lost the HTTP response.
    const { consume } = await import('../../src/accounting/consume.js');
    const committed = await consume({ accountId: account.id, externalId: 'lost-reply', units: 7, requestId: 'lost-response' });
    strictEqual(committed.accepted, true);
    strictEqual(committed.replayed, false);
    strictEqual((await t.call(`/v1/plans/${plan.data.id}`, 'PATCH', { monthlyLimit: 0 }, account.apiKey)).status, 200);

    const retry = await t.call('/v1/consume', 'POST', { userId: 'lost-reply', units: 7, requestId: 'lost-response' }, account.apiKey);
    strictEqual(retry.status, 200);
    strictEqual(retry.data.replayed, true);
    strictEqual(retry.data.accepted, true);
    deepStrictEqual(retry.data.account, committed.account);
    deepStrictEqual(retry.data.user, committed.user);
    strictEqual((await t.call('/v1/usage', 'GET', undefined, account.apiKey)).data.used, 7);
    strictEqual((await t.call('/v1/usage', 'GET', undefined, account.apiKey)).data.remaining, 0);
    const newlyAttempted = await t.call('/v1/consume', 'POST', {
      userId: 'lost-reply', units: 1, requestId: 'new-after-limit-reduction',
    }, account.apiKey);
    strictEqual(newlyAttempted.data.accepted, false);
    strictEqual(newlyAttempted.data.rejection.level, 'account');
  } finally { await t.close(); }
});

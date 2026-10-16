import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, freemem, platform, release, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { makeScenario, type ScenarioDefinition, type ScenarioName, type WorkItem } from './scenarios.js';
import { verifyResults, type AccountObservation, type DecisionRecord, type ObservedDecision } from './verify.js';

type Json = Record<string, unknown>;

interface Config {
  baseUrl: string;
  adminToken: string;
  scenario: ScenarioName | 'all';
  requests: number;
  concurrency: number;
  accounts?: number;
  usersPerAccount?: number;
  repeats: number;
  output?: string;
}

interface PreparedAccount {
  id: string;
  apiKey: string;
  users: string[];
  planId?: string;
}

interface Sample {
  latencyMs: number;
  decision?: ObservedDecision;
  error?: string;
}

interface RunResult {
  scenario: ScenarioName;
  run: number;
  setupAccounts: number;
  setupUsers: number;
  requests: number;
  accepted: number;
  rejected: number;
  replayed: number;
  unexpectedErrors: number;
  durationMs: number;
  requestsPerSecond: number;
  latencyMs: { p50: number; p95: number; p99: number; max: number };
  verification: ReturnType<typeof verifyResults>;
  errors: string[];
}

class ApiError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`);
  }
}

function parseArgs(): Config {
  const values = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i]!;
    if (!arg.startsWith('--') || !process.argv[i + 1] || process.argv[i + 1]!.startsWith('--')) {
      throw new Error(`Expected --name value, received ${arg}`);
    }
    values.set(arg.slice(2), process.argv[++i]!);
  }
  const allowed = new Set(['scenario', 'requests', 'concurrency', 'accounts', 'users', 'repeats', 'output', 'url']);
  for (const key of values.keys()) if (!allowed.has(key)) throw new Error(`Unknown option --${key}`);
  const scenario = values.get('scenario') ?? 'all';
  if (!['all', 'distributed', 'hot', 'retries', 'plan-changes', 'rejection'].includes(scenario)) {
    throw new Error(`Unknown scenario ${scenario}`);
  }
  const integer = (key: string, fallback: number, maximum: number): number => {
    const raw = values.get(key);
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new Error(`--${key} must be an integer from 1 to ${maximum}`);
    }
    return value;
  };
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) throw new Error('ADMIN_TOKEN is required to create isolated benchmark accounts');
  return {
    baseUrl: (values.get('url') ?? process.env.API_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
    adminToken,
    scenario: scenario as Config['scenario'],
    requests: integer('requests', 1000, 100000),
    concurrency: integer('concurrency', 32, 1000),
    accounts: values.has('accounts') ? integer('accounts', 1, 1000) : undefined,
    usersPerAccount: values.has('users') ? integer('users', 1, 1000) : undefined,
    repeats: integer('repeats', 1, 20),
    output: values.get('output'),
  };
}

async function request(baseUrl: string, path: string, options: { method?: string; token?: string; adminToken?: string; body?: Json } = {}): Promise<unknown> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Authorization = `ApiKey ${options.token}`;
  if (options.adminToken) headers['X-Admin-Token'] = options.adminToken;
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const body = await response.text();
  if (!response.ok) throw new ApiError(response.status, body);
  try { return JSON.parse(body) as unknown; }
  catch { throw new Error(`Invalid JSON from ${path}`); }
}

function object(value: unknown, label: string): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is not an object`);
  return value as Json;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is missing`);
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is not a nonnegative safe integer`);
  return value;
}

function listPlans(body: unknown): Json[] {
  const array = Array.isArray(body) ? body : object(body, 'plans').plans;
  if (!Array.isArray(array)) throw new Error('GET /v1/plans did not return a plan array');
  return array.map((plan) => object(plan, 'plan'));
}

async function setup(config: Config, scenario: ScenarioDefinition): Promise<PreparedAccount[]> {
  const accounts: PreparedAccount[] = [];
  const runId = randomUUID().slice(0, 8);
  for (let a = 0; a < scenario.accountCount; a++) {
    const created = object(await request(config.baseUrl, '/admin/accounts', {
      method: 'POST', adminToken: config.adminToken,
      body: { name: `load-${scenario.name}-${runId}-${a}`, planName: 'Pro' },
    }), 'created account');
    const account: PreparedAccount = { id: string(created.id, 'account id'), apiKey: string(created.apiKey, 'API key'), users: [] };
    const plans = listPlans(await request(config.baseUrl, '/v1/plans', { token: account.apiKey }));
    const premium = plans.find((plan) => plan.scope === 'user' && plan.name === 'Premium' && plan.ownerAccountId == null);
    if (!premium) throw new Error('Seeded Premium user plan is missing');
    const premiumId = string(premium.id, 'Premium plan id');
    for (let u = 0; u < scenario.usersPerAccount; u++) {
      const externalId = `load-${runId}-${a}-${u}`;
      await request(config.baseUrl, '/v1/users', {
        method: 'POST', token: account.apiKey, body: { externalId, planId: premiumId },
      });
      account.users.push(externalId);
    }
    if (scenario.name === 'plan-changes') {
      const plan = object(await request(config.baseUrl, '/v1/plans', {
        method: 'POST', token: account.apiKey,
        body: {
          name: `Load account ${runId}`,
          scope: 'account',
          monthlyLimit: Math.max(1000, scenario.items.length * 2),
          maxPerRequest: 500,
        },
      }), 'created plan');
      account.planId = string(plan.id, 'custom plan id');
      await request(config.baseUrl, '/v1/account/plan', {
        method: 'PUT', token: account.apiKey, body: { planId: account.planId },
      });
    }
    accounts.push(account);
  }
  return accounts;
}

async function timedConsume(config: Config, accounts: PreparedAccount[], item: WorkItem): Promise<Sample> {
  const account = accounts[item.account]!;
  const start = performance.now();
  try {
    const response = object(await request(config.baseUrl, '/v1/consume', {
      method: 'POST', token: account.apiKey,
      body: { userId: account.users[item.user], units: item.units, requestId: item.requestId },
    }), 'consume response');
    const latencyMs = performance.now() - start;
    if (typeof response.accepted !== 'boolean' || typeof response.replayed !== 'boolean') {
      throw new Error('Consume response lacks accepted or replayed');
    }
    return {
      latencyMs,
      decision: {
        accountIndex: item.account,
        userIndex: item.user,
        requestId: item.requestId,
        units: item.units,
        accepted: response.accepted,
        replayed: response.replayed,
      },
    };
  } catch (error) {
    return { latencyMs: performance.now() - start, error: `${item.requestId}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function runWork(config: Config, scenario: ScenarioDefinition, accounts: PreparedAccount[]): Promise<{ samples: Sample[]; durationMs: number; mutationError?: string }> {
  const samples: Sample[] = new Array(scenario.items.length);
  let next = 0;
  let mutation: Promise<void> | undefined;
  let mutationError: string | undefined;
  const start = performance.now();
  const worker = async (): Promise<void> => {
    while (next < scenario.items.length) {
      const index = next++;
      if (index === scenario.mutationAt && !mutation) {
        const account = accounts[0]!;
        mutation = request(config.baseUrl, `/v1/plans/${string(account.planId, 'custom plan id')}`, {
          method: 'PATCH', token: account.apiKey,
          body: { monthlyLimit: Math.max(1, Math.floor(scenario.items.length / 2)) },
        }).then(() => undefined, (error: unknown) => {
          mutationError = error instanceof Error ? error.message : String(error);
        });
      }
      samples[index] = await timedConsume(config, accounts, scenario.items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(config.concurrency, scenario.items.length) }, () => worker()));
  if (mutation) await mutation;
  return { samples, durationMs: performance.now() - start, mutationError };
}

function usedFrom(body: unknown, level: 'account' | 'user'): number {
  const value = object(body, 'usage');
  const nested = value[level];
  if (nested && typeof nested === 'object') return number(object(nested, level).used, `${level}.used`);
  return number(value.used, 'usage.used');
}

async function history(config: Config, account: PreparedAccount): Promise<DecisionRecord[]> {
  const rows: DecisionRecord[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const path = `/v1/requests?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const result = object(await request(config.baseUrl, path, { token: account.apiKey }), 'history page');
    const items = result.items ?? result.requests;
    if (!Array.isArray(items)) throw new Error('History page lacks items array');
    for (const item of items) {
      const row = object(item, 'history item');
      if (typeof row.accepted !== 'boolean') throw new Error('History item lacks accepted');
      rows.push({ requestId: string(row.requestId, 'history requestId'), units: number(row.units, 'history units'), accepted: row.accepted, userId: typeof row.userId === 'string' ? row.userId : undefined });
    }
    const next = result.nextCursor;
    if (next == null || next === '') return rows;
    cursor = string(next, 'next cursor');
    if (seenCursors.has(cursor)) throw new Error('History cursor repeated');
    seenCursors.add(cursor);
  }
}

async function observe(config: Config, accounts: PreparedAccount[]): Promise<AccountObservation[]> {
  const observations: AccountObservation[] = [];
  for (let a = 0; a < accounts.length; a++) {
    const account = accounts[a]!;
    const used = usedFrom(await request(config.baseUrl, '/v1/usage', { token: account.apiKey }), 'account');
    const users: AccountObservation['users'] = [];
    for (let u = 0; u < account.users.length; u++) {
      const externalId = account.users[u]!;
      const body = await request(config.baseUrl, `/v1/users/${encodeURIComponent(externalId)}/usage`, { token: account.apiKey });
      users.push({ index: u, used: usedFrom(body, 'user') });
    }
    observations.push({ accountIndex: a, used, users, history: await history(config, account) });
  }
  return observations;
}

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

async function oneRun(config: Config, scenarioName: ScenarioName, run: number): Promise<RunResult> {
  const scenario = makeScenario({ scenario: scenarioName, requests: config.requests, accounts: config.accounts, usersPerAccount: config.usersPerAccount });
  process.stdout.write(`Preparing ${scenario.name} run ${run}: ${scenario.accountCount} accounts, ${scenario.accountCount * scenario.usersPerAccount} users\n`);
  const accounts = await setup(config, scenario);
  const { samples, durationMs, mutationError } = await runWork(config, scenario, accounts);
  const decisions = samples.flatMap((sample) => sample.decision ? [sample.decision] : []);
  const errors = samples.flatMap((sample) => sample.error ? [sample.error] : []);
  if (mutationError) errors.push(`Plan mutation: ${mutationError}`);
  let verification: RunResult['verification'];
  try { verification = verifyResults(decisions, await observe(config, accounts)); }
  catch (error) {
    verification = { ok: false, failures: [`Observation failed: ${error instanceof Error ? error.message : String(error)}`], accountCount: 0, historyRows: 0, acceptedHistoryUnits: 0 };
  }
  if (scenarioName === 'retries') {
    const expectedReplays = samples.length - new Set(scenario.items.map((item) => item.requestId)).size;
    const actualReplays = decisions.filter((decision) => decision.replayed).length;
    if (actualReplays !== expectedReplays) {
      verification.failures.push(`Expected ${expectedReplays} idempotent replays, observed ${actualReplays}`);
      verification.ok = false;
    }
  }
  if (scenarioName === 'rejection' && decisions.some((decision) => decision.accepted)) {
    verification.failures.push('A request above the Premium user per-request limit was accepted');
    verification.ok = false;
  }
  const latencies = samples.map((sample) => sample.latencyMs).sort((a, b) => a - b);
  return {
    scenario: scenarioName, run,
    setupAccounts: accounts.length,
    setupUsers: accounts.reduce((sum, account) => sum + account.users.length, 0),
    requests: samples.length,
    accepted: decisions.filter((decision) => decision.accepted).length,
    rejected: decisions.filter((decision) => !decision.accepted).length,
    replayed: decisions.filter((decision) => decision.replayed).length,
    unexpectedErrors: errors.length,
    durationMs,
    requestsPerSecond: samples.length / (durationMs / 1000),
    latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95), p99: percentile(latencies, 0.99), max: latencies.at(-1) ?? 0 },
    verification,
    errors: errors.slice(0, 25),
  };
}

async function main(): Promise<void> {
  const config = parseArgs();
  const scenarios: ScenarioName[] = config.scenario === 'all'
    ? ['distributed', 'hot', 'retries', 'plan-changes', 'rejection']
    : [config.scenario];
  const result = {
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version, platform: platform(), osRelease: release(), cpus: cpus().map((cpu) => cpu.model),
      totalMemoryBytes: totalmem(), freeMemoryBytesAtStart: freemem(),
      databaseVersion: 'not exposed by HTTP API', apiBaseUrl: config.baseUrl,
      concurrency: config.concurrency, requestsPerScenario: config.requests, repeats: config.repeats,
    },
    runs: [] as RunResult[],
  };
  for (const scenario of scenarios) {
    for (let repeat = 1; repeat <= config.repeats; repeat++) {
      const run = await oneRun(config, scenario, repeat);
      result.runs.push(run);
      process.stdout.write(`${scenario} #${repeat}: ${run.requestsPerSecond.toFixed(1)} req/s, p50/p95/p99/max ${run.latencyMs.p50.toFixed(1)}/${run.latencyMs.p95.toFixed(1)}/${run.latencyMs.p99.toFixed(1)}/${run.latencyMs.max.toFixed(1)} ms, accepted ${run.accepted}, rejected ${run.rejected}, replayed ${run.replayed}, errors ${run.unexpectedErrors}, reconciled ${run.verification.ok}\n`);
      for (const failure of run.verification.failures.slice(0, 10)) process.stderr.write(`  ${failure}\n`);
    }
  }
  if (config.output) {
    const target = resolve(config.output);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(result, null, 2) + '\n', 'utf8');
    process.stdout.write(`Wrote ${target}\n`);
  }
  if (result.runs.some((run) => run.unexpectedErrors > 0 || !run.verification.ok)) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

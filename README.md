# Usage Metering & Quota Service

A calling application asks this service whether an action may consume integer usage units. Each application is an **Account** with an API key and one shared monthly allowance. Each of its **Users** has a separate monthly allowance. A request succeeds only when it fits both monthly allowances and both maximum-per-request rules. An accepted decision increments both counters once. A rejected decision increments neither and is kept in request history.

The service is a single TypeScript and Express API backed by PostgreSQL 17. A separate TypeScript CLI demonstrates integration over HTTP using Node's built-in `fetch`. PostgreSQL owns all quota, idempotency, and decision data; there is no Redis, queue, payment system, or additional service.

## Repository map

```text
service/src/       Express routes, authentication, services, pure rules, accounting, database
service/test/      TypeScript unit, integration, concurrency, and security tests
client/src/       HTTP client, commands, and repeatable demo
loadtest/         HTTP load scenarios and database reconciliation
docs/             API, transactions, architecture, assumptions, performance, review
docker-compose.yml
```

The request flow is HTTP → authentication → explicit input validation → application service → PostgreSQL transaction → JSON response. [Architecture](docs/architecture.md) explains the layers and tables. [Transactions](docs/transactions.md) describes the lock order and failure handling. The implementation uses Drizzle for the schema, Plan seeding, and migrations, with parameterized SQL where the required PostgreSQL locking is clearer directly.

## Quick start with Docker

Use Node.js 24 LTS and Docker Compose. From this directory:

```bash
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Replace `ADMIN_TOKEN` in `.env` with the generated value. Keep `.env` private; the example token is intentionally rejected by startup validation. Then run:

```bash
docker compose up --build
```

Compose starts persistent PostgreSQL, waits for its health check, runs migrations and idempotent Plan seeding, and starts the API. The API must pass its readiness check before use. `docker compose down` stops containers while preserving the named database volume. Only an explicitly requested `docker compose down -v` removes the data volume.

The API is reachable on `http://localhost:3000` unless Compose's `API_HOST_PORT` is changed. `PORT` controls the server port when running outside Compose. `GET /healthz` is process liveness; `GET /readyz` is database/application readiness. The containerized client uses the Compose hostname `http://api:3000` for `API_BASE_URL`; a host-run client uses `http://localhost:3000`. **The default Compose stack includes all three services**: database, API, and a *one-shot* demo client. After the demo finishes successfully the client container exits with code 0; this is expected, not a crash. Inspect its output with `docker compose logs client`. The database and API keep running. The API and PostgreSQL host ports are bound to `127.0.0.1` for local use.

## npm setup

From this directory:

```bash
npm ci
npm run build
npm run typecheck
```

`npm install` also works for development; `npm ci` verifies installation from the committed lockfile. To run the API outside Compose, supply a PostgreSQL 17 `DATABASE_URL`, a random `ADMIN_TOKEN` of at least 32 characters, and optionally `PORT` and `DB_POOL_SIZE`. Run migrations and seeding before starting the service:

```bash
npm run db:migrate
npm run db:seed
npm run start
```

Integration, concurrency, and security tests require a dedicated database whose name ends in `_test`. With the Compose database running, create it once and set the test URL:

```bash
docker compose exec -T db createdb -U meter metering_test
```

In PowerShell, set `$env:TEST_DATABASE_URL='postgresql://meter:meter@localhost:55432/metering_test'`; in a POSIX shell, export the same variable. The tests refuse any database name without the `_test` suffix. Test setup migrates and seeds that database and creates unique Accounts without clearing unrelated data.

## Plans and monthly behavior

Four predefined Plans are seeded once and remain globally readable and immutable:

| Scope | Plan | Monthly units | Maximum per request |
| --- | --- | ---: | ---: |
| Account | Starter | 10,000 | 100 |
| Account | Pro | 100,000 | 500 |
| User | Basic | 1,000 | 20 |
| User | Premium | 5,000 | 100 |

An Account can create Account- or User-scope custom Plans. Only that Account can read, update, or assign them. Multiple Users may share a User Plan definition but have separate counters. Account usage is the total accepted consumption across its Users. A Plan switch or definition update changes future decisions while preserving all past usage and request snapshots. If a Plan limit is reduced below used units, remaining reports zero and further consumption is rejected until allowance becomes available. Months are UTC calendar months; no reset job deletes or rewrites a previous month.

Rules are checked in a stable order: User maximum per request, Account maximum per request, User monthly allowance, Account monthly allowance. The first blocker is reported as a `level`, `rule`, and `limit` in a completed HTTP 200 decision. All public unit values must be positive JSON safe integers; Plans may set a zero monthly allowance.

## HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/healthz` | Process liveness |
| GET | `/readyz` | Database/application readiness |
| POST | `/admin/accounts` | Create Account and display one new API key |
| GET | `/v1/account` | Authenticated Account, Plan, current usage |
| PUT | `/v1/account/plan` | Switch Account Plan |
| GET | `/v1/plans` | Global and owned Plans |
| POST | `/v1/plans` | Create owned Plan |
| GET | `/v1/plans/:id` | Read visible Plan |
| PATCH | `/v1/plans/:id` | Update owned custom Plan |
| POST | `/v1/users` | Register external User |
| GET | `/v1/users/:userId` | Read Account User |
| PUT | `/v1/users/:userId/plan` | Switch User Plan |
| POST | `/v1/consume` | Make and store one quota decision |
| GET | `/v1/usage` | Account month usage |
| GET | `/v1/users/:userId/usage` | User month usage |
| GET | `/v1/requests` | Keyset-paginated decision history |

See [API reference](docs/api.md) for a curl request for each endpoint, JSON examples, credential headers, and error statuses. The Account key uses `Authorization: ApiKey <key>`. The Admin creation endpoint uses `X-Admin-Token`. Raw API keys appear only in the Account creation response and are stored by the service only as SHA-256 digests of 32 random bytes.

For example, after creating an Account and User:

```bash
curl -s -X POST http://localhost:3000/v1/consume \
  -H "Authorization: ApiKey $API_KEY" -H 'Content-Type: application/json' \
  -d '{"userId":"ahmad","units":10,"requestId":"doc-123"}'
```

Each `requestId` is unique within an Account. Repeating it with the same User and units returns the original decision with `replayed: true`, without a second increment. Reusing it with different immutable inputs returns HTTP 409. A retry after an HTTP response is lost is safe, including when the original request was rejected.

## TypeScript CLI

The CLI calls the real HTTP API. `create-account` creates a local key file with owner-only permissions; set `CLIENT_CONFIG_FILE` to change its location or `API_KEY` to supply a key without the file. The complete demo keeps its key in memory, creates a fresh Account name each time, and can run repeatedly without deleting data.

```bash
npm run client -- create-account demo-co Starter
npm run client -- add-user ahmad Basic
npm run client -- process-doc ahmad 10
npm run client -- usage ahmad
npm run client -- switch-plan ahmad Premium
npm run client -- history ahmad
npm run client -- demo
```

The demo needs `ADMIN_TOKEN` and `API_BASE_URL` in its environment. It creates two Users with different Plans, accepts a request, rejects at a User maximum, fills and rejects at the shared Account allowance, raises the Account Plan limit, accepts a new request, replays an earlier request, and displays usage and history. It checks expected outcomes and exits with an error if one differs.

The `docker compose up --build` quick start **automatically runs the demo client once**, with no special profile. To replay a fresh demo against the already-running API, run `docker compose run --rm client demo`. The demo creates a new Account on each run; it does not reset or overwrite previous data. The CLI commands above are an alternative manual workflow.

## Tests and load testing

These root scripts are the verification interface:

```bash
npm run test:unit
npm run test:integration
npm run test:concurrency
npm run test:security
npm test
npm run loadtest
npm run db:reconcile
```

Unit tests check pure rule order and boundaries. Integration tests use real PostgreSQL for endpoints, Plan changes, idempotency, month behavior, and counter/history reconciliation. Concurrency tests use separate database connections and controlled contention; they must not be replaced with a mock database. Security tests exercise credential handling, Account isolation, hostile inputs, and sanitized errors. The load runner reports accepted/rejected/error counts, throughput, and p50/p95/p99/max latency, then compares HTTP usage with persisted history and observed decisions. `db:reconcile` requires `DATABASE_URL` and directly compares all PostgreSQL counters with accepted history. [Performance](docs/performance.md) contains a committed measured run, its hardware/assumptions, findings, and reproduction commands. The [acceptance matrix](docs/acceptance-matrix.md) maps every assignment deliverable to its implementation and verification.

For the complete PostgreSQL-backed test suite in Windows PowerShell (after creating the test database):

```powershell
$env:TEST_DATABASE_URL = 'postgresql://meter:meter@localhost:55432/metering_test'
npm test
```

The latest user-run verification on 2026-10-23 passed **21/21 tests**. An isolated clean-volume Docker Compose verification also passed: the full demo, migrations/seed, and database persistence after container recreation. These checks do **not** establish that the service is fully secure for public deployment; see [security review](docs/security-review.md).

## Concurrency and integrity

One PostgreSQL transaction claims the `(account_id, request_id)` key, takes an Account configuration `FOR SHARE` lock, reads effective Plans, selects the processing UTC month, locks the User and Account monthly rows in that order, evaluates all four rules, updates both counters or neither, records the final decision, and commits. Plan changes acquire an incompatible `FOR UPDATE` Account lock. This gives each consumption a consistent Plan configuration and makes a Plan change visible to later admitted requests. A rollback removes the request claim and any tentative changes. See [transactions](docs/transactions.md) for the precise protocol and [engineering review](docs/engineering-review.md) for course-level explanations.

The database has uniqueness, foreign-key, Plan-assignment triggers, and nonnegative usage constraints; route validation also checks assignment scope and ownership before writing. Each accepted request should add exactly its units to one User counter and one Account counter; summing accepted history for each entity/month independently checks this invariant. A hot Account can limit throughput because its shared monthly counter must serialize writes. Correctness takes priority over an unmeasured SQL optimization.

## Security and operational boundaries

Account creation requires a random Admin token from the environment. Account API keys are generated with Node `crypto.randomBytes(32)` and stored only as digests. Account-scoped queries use the authenticated Account ID, including Plan ownership and history filters. Input lengths and page sizes are bounded, and error responses avoid SQL internals. Secrets and generated data are ignored by Git. Dependencies are pinned by `package-lock.json`: Express is the HTTP server, Drizzle provides schema and migrations, `pg` supplies PostgreSQL connections, `tsx` runs TypeScript tools and tests, and TypeScript checks the application.

Operational limits and pagination consistency are listed in [limitations](docs/limitations.md). Product behavior choices and reasons are in [assumptions](docs/assumptions.md). The [submission audit](docs/acceptance-matrix.md) lists rubric coverage, verification evidence, and remaining caveats. The API offers a quota decision and cannot make a caller's later business action atomic with that decision. A caller should use one stable request ID per action and define how it handles an action that fails after consumption was accepted.

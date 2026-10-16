# HTTP load test

Run against a ready service with an admin token:

```bash
ADMIN_TOKEN=... API_BASE_URL=http://localhost:3000 npm run loadtest -- --scenario all --requests 1000 --concurrency 32 --repeats 3 --output loadtest/results/local.json
```

PowerShell:

```powershell
$env:ADMIN_TOKEN = '...'
$env:API_BASE_URL = 'http://localhost:3000'
npm run loadtest -- --scenario hot --requests 1000 --concurrency 32 --output loadtest/results/hot.json
```

Scenarios: `distributed` (50 accounts, 10 users each), `hot` (one account, 200 users), `retries` (20% repeated request IDs, including concurrent and later retries), `plan-changes` (reduces an assigned custom account plan during traffic), and `rejection` (all requests exceed the Premium user per-request cap). `--accounts` and `--users` override setup sizes. Each run creates fresh accounts, so existing database contents do not influence measured usage.

Setup, plan creation, and final verification are excluded from the timed interval. Each consumption latency includes the HTTP round trip and JSON parsing. Percentiles use the nearest-rank definition over all attempted requests; throughput divides attempted requests by the measured consume phase duration. The JSON result includes Node and host CPU/memory information. PostgreSQL version is marked unavailable because the public API does not expose it.

The runner checks HTTP decisions against the committed request history, checks the account counter against accepted history units, checks user counters against accepted decisions, and checks the user sum against the account counter. It exits unsuccessfully on request errors or reconciliation failures. These checks use the API, so a separate direct SQL reconciliation remains valuable when validating database constraints or diagnosing a failure.

The runner does not delete its setup accounts. Use a dedicated benchmark database if repeated runs would create too much retained history. Do not put an admin token or API key in a result file.

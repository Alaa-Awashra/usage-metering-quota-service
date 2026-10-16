# Performance

The TypeScript HTTP load runner reports total requests, accepted and rejected decisions, unexpected errors, throughput, and p50/p95/p99/max latency. Its scenarios cover distributed Accounts, a hot Account, duplicate request IDs, Plan changes during load, and per-request rule rejections. It compares observed HTTP decisions against persisted history and both levels of usage returned by the API. Direct PostgreSQL reconciliation SQL is a separate test concern. Throughput measurements should use allowances high enough to exercise successful counter writes and report acceptance rate separately.

## Measured run, 2026-10-16

The committed [result JSON](../loadtest/results/baseline-2026-10-16.json) records one run per scenario against the Compose API and PostgreSQL 17. The host was Windows 10 with an Intel i5-7300HQ (4 logical CPUs), 12.8 GB RAM, Node 24.14.1, an API pool of 20, 100 HTTP requests per scenario, and concurrency 16. The distributed setup used 50 Accounts and 500 Users; the hot setup used one Account and 200 Users. Setup and verification time are excluded from throughput. This single run does not establish variability or a general capacity limit.

| Scenario | Accepted / requests | Replayed | Throughput req/s | p50 ms | p95 ms | p99 ms | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Distributed | 100 / 100 | 0 | 30.4 | 169.6 | 2290.6 | 2971.0 | 0 |
| Hot Account | 100 / 100 | 0 | 26.8 | 515.7 | 1155.6 | 1375.2 | 0 |
| Idempotency retries | 100 / 100 | 20 | 33.7 | 284.4 | 1116.7 | 1300.7 | 0 |
| Plan changes | 100 / 100 | 0 | 25.5 | 441.3 | 1190.9 | 1342.2 | 0 |
| Rejection heavy | 0 / 100 | 0 | 25.4 | 573.6 | 694.3 | 801.1 | 0 |

All five HTTP reconciliation checks passed. `npm run db:reconcile` then queried PostgreSQL directly and reported zero Account mismatches, zero User mismatches, and zero committed pending decisions. The accepted count in the retry scenario includes replay responses; only 80 unique accepted history rows were written. Because the hot and distributed paths ran under different contention patterns and setup sizes, these numbers describe this run rather than an optimization comparison.

`EXPLAIN (ANALYZE, BUFFERS)` on one Account counter lookup showed a sequential scan over 57 rows, two shared buffer hits, and 0.079 ms execution. PostgreSQL reasonably chose that path for the tiny table even though the composite primary key exists. A five-row Account history lookup used a bitmap index scan followed by an in-memory sort, with 0.224 ms execution. These small read probes do not explain the HTTP tail latencies; the load run points to transaction and hot-row contention as areas for a larger controlled study.

For a stronger performance study, repeat each scenario at least three times and report the spread. PostgreSQL was the Compose `postgres:17-alpine` image; its startup log identified version 17.11. Use `EXPLAIN (ANALYZE, BUFFERS)` on representative queries when investigating a measured bottleneck.

Run a focused scenario with `npm run loadtest -- --scenario hot --requests 1000 --concurrency 32 --repeats 3 --output loadtest/results/hot.json`. The `all` scenario runs the five workloads. The command requires `ADMIN_TOKEN` and a reachable `API_BASE_URL`; it creates fresh benchmark Accounts, so setup changes persistent data. Current JSON output records Node and host details but labels PostgreSQL version as unavailable through HTTP. Record `SELECT version()` and the configured pool size alongside any published result.

The reference row-locking transaction is the correctness baseline. A conditional UPSERT would need a guarded first insert as well as a guarded conflict update and must pass the same concurrency and Plan-change tests before replacing the baseline. Fewer SQL statements alone are not evidence of better throughput.

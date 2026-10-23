# Final acceptance matrix — original assignment

**Review date: 2026-10-23.** Basis: source in the project, the assignment text, successful 21/21 local PostgreSQL-backed tests, 5/5 local HTTP load scenarios with reconciliation, and the successful fresh-volume Docker/persistence run. Where stated, files/tests are independently inspectable. Passing tests does not prove every possible defect is absent.

| Assignment requirement | Implementation / reproducible evidence | Assessment |
| --- | --- | --- |
| TypeScript + SQL with one backend and PostgreSQL | `service/src/`, `service/src/db/`, `service/Dockerfile`, `docker-compose.yml` | Covered |
| Create Accounts and issue per-Account API keys | `POST /admin/accounts`; `service/src/services/accounts.ts`, `auth.ts` | Covered |
| Require keys and separate Accounts/Users | `service/src/auth.ts`; Account-scoped queries; `service/test/security/auth.test.ts`, `boundaries.test.ts` | Covered; tests passed |
| Register Users and change User/Account Plans | `service/src/routes/users.ts`, `account.ts`; `services/users.ts`, `accounts.ts` | Covered |
| Predefined Plans at startup | `service/src/db/seed.ts`: Starter, Pro, Basic, Premium | Covered; Phase 4 fresh start passed |
| Custom Plans create/view/update and assignments | `services/plans.ts`, `routes/plans.ts`; ownership & scope enforced | Covered |
| Shared Account + individual User quotas | `service/src/accounting/consume.ts`, `rules/evaluate.ts` | Covered; integration/concurrency tests passed |
| UTC monthly allowance + maximum per request at both levels | Same modules; `service/test/integration/month.test.ts` and rule tests | Covered; edge tests passed |
| Atomic all-or-nothing debit, detailed rejection | PostgreSQL transaction updates both counters or neither; stores rule level | Covered; rollback injection test passed |
| Plan changes take effect, no usage reset, clamp remaining to zero | Plan mutation locks, existing counter rows, `remaining()`; concurrency tests | Covered |
| Same request safe to retry, different input conflicts | `(account_id, request_id)` unique index; replay and `409`; `service/test/concurrency/reliability.test.ts` | Covered; 17/17 phase 2 passed |
| Read current/past usage and outcomes; paginate history | `/v1/usage`, `/v1/users/:id/usage`, `/v1/requests`; `services/usage.ts`, `services/history.ts` | Covered; UTC boundary and timezone tests passed |
| Persistence across restarts | PostgreSQL named volume, migrations, seed; `scripts/verify-fresh-docker.ps1` | Covered; Phase 4 PASS |
| Example client, two User Plans, both rejections, Plan change | `client/src/demo.ts`, `client/Dockerfile` | Covered; demo PASS |
| Default `docker compose up --build` includes db+API+client | `docker-compose.yml` has all three default services; one-shot client executes `demo` | Covered; Phase 4 PASS |
| Automated behavior, tenant security and concurrency tests | `service/test/` and `npm test` with PostgreSQL test DB | Covered; **21/21 passed** |
| Load test scripts, committed results and reproduction guidance | `loadtest/`, `loadtest/results/baseline-2026-10-16.json`, `docs/performance.md` | Covered; five scenarios; single-run limitation documented |
| README includes local setup, API keys, rules, Plan changes, retries, assumptions, limitations | `README.md`, `docs/api.md`, `docs/assumptions.md`, `docs/limitations.md`, `docs/transactions.md` | Covered after docs update |
| Explain technical decisions, limitations, and request path | `docs/architecture.md`, `docs/transactions.md`, `docs/engineering-review.md` | Covered; be prepared to explain in discussion |
| GitHub repo published with the **final** tested changes | `git status`, commit, push, inspect remote | **Requires final local Git confirmation** |

## Open notes (not automatic disqualifiers for the training brief)

1. **Security advisory remains:** the pinned `drizzle-orm@0.44.6` is below its patched `0.45.2` release. The relevant SQL identifier injection pattern is not present in the audited runtime code, but the advisory remains real. Follow up with a tested compatible dependency upgrade before using the service in a public environment. Also move the Node runtime to a current security-patched build. See `docs/security-review.md`.
2. **Benchmark scope:** the committed baseline represents one machine and one run per scenario. It demonstrates correctness and provides measured bottlenecks, but does not establish service-level capacity, p99 SLOs, or performance of another machine.
3. **Operational scope:** the demo uses development database credentials and an Admin token available to its container. Do not treat the Compose example as a production-hardened deployment.
4. **Git remote:** successful local tests do not prove that the GitHub branch has the latest changes. Confirm with `git status`, `git log`, and `git push`; do not stage `.env` or downloaded ZIP archives.

## Minimal final commands (Windows PowerShell)

```powershell
# Current working tree and accidental untracked files
git status --short
# Ensure patch has no whitespace errors
git diff --check
# Confirm Compose includes all 3 default services
docker compose config --services
# The test suite already passed on 2026-10-23; re-run only if source code changed.
# $env:TEST_DATABASE_URL = 'postgresql://meter:meter@localhost:55432/metering_test'
# npm test
```

Before committing, inspect `git status` and stage **only** the intended project files, not local `.env`, token files or ZIP archives. Verify `git remote -v` points to the intended repository; commit and push your current branch, then inspect the published GitHub README and newly added tests/docs. Do not claim a remote update before seeing the successful push.

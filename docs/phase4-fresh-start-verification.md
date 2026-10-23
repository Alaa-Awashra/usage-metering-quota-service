# Phase 4 — Fresh Docker startup, migrations, and persistence check

Run after applying phases 1, 2 and 3. This test is non-destructive to your existing local project database.

## Run on Windows PowerShell in the repository root

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-fresh-docker.ps1
```

## Checked behavior

1. Creates a unique Docker Compose project name and dynamically selected localhost ports. Generates a random admin token only inside this PowerShell process; it does not overwrite `.env`.
2. Runs the **default** `docker compose up --build -d` on a brand-new temporary Postgres named volume, starting `db`, `api`, and `client` together.
3. Waits for the demo client to finish with exit code 0 and the `Demo completed successfully.` marker.
4. Checks `/readyz`, the Drizzle migration tracking table, four seeded global plans, one demo account, five persisted decisions, and 16 consumed units in both account and aggregate user counters. The duplicate retry must not create a sixth decision.
5. Uses `docker compose down` **without** `-v` to remove all temporary containers and networks while preserving the temporary DB volume.
6. Recreates the database/API containers, waits for healthy status, and checks that the six database totals remain identical, confirming data persistence and idempotent migration/seeding.
7. Always calls `docker compose -p <temporary-id> down --volumes --remove-orphans` to clean up **only the unique temporary test project**. The normal project's containers and volume are never targeted.

Expected last success line: `PHASE 4 PASS: fresh Docker start, full demo, migrations, persisted data and clean recreation.`

**Note:** If the Docker build or client fails, the script will throw and clean up the temporary stack. It has not been executed in this artifact-generation environment because Docker Engine/Windows PowerShell are unavailable here; its final status must be established from the user's local terminal output.

## Corrected verification script (v3)

Retains the PowerShell string and array-splat fixes from v2, and replaces the problematic `docker inspect -f` call with structured `docker compose ps --all --format json client` status checks. No production service code changed. The full Docker verification still requires the local Windows/Docker environment.

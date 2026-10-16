# Architecture

This is one Express service backed by one PostgreSQL 17 database. A calling application owns an Account and authenticates with its API key. Its users are identified by Account-scoped external IDs. Each accepted request consumes from the individual User allowance and the shared Account allowance. The TypeScript CLI is an example of a separate application that uses only HTTP.

```text
HTTP request
  -> API key or Admin token authentication
  -> explicit TypeScript input validation
  -> route and application service
  -> pure rule evaluation inside transactional accounting
  -> PostgreSQL counters plus decision history
  -> JSON response
```

Routes parse HTTP details and return status codes. Authentication resolves a trusted Account ID from a SHA-256 API-key digest. Services enforce Plan ownership and Account scoping. The accounting module owns consumption transactions. Rule evaluation accepts effective Plan limits, used amounts, and requested units without database access or side effects.

## Tables

| Table | Purpose |
| --- | --- |
| `plans` | Global predefined and Account-owned custom definitions; scope is `account` or `user`. |
| `accounts` | Calling applications and their assigned Account Plan. |
| `users` | External IDs unique within an Account and assigned User Plans. |
| `api_keys` | Account ID, identifying prefix, and digest; never a raw secret. |
| `account_monthly_usage` | Shared accepted units keyed by Account and UTC month. |
| `user_monthly_usage` | Individual accepted units keyed by User and UTC month. |
| `consume_requests` | Final accepted or rejected decisions, immutable request inputs, effective Plan snapshots, and used-after snapshots. |

Monthly counters make current and historical usage reads proportional to a small indexed lookup instead of scanning all history. History remains necessary for idempotency, audit, and independent reconciliation. Constraints protect nonnegative usage and unique `(account_id, request_id)` decisions. Indexes support Account and User history in descending request ID order.

## Plan lifecycle

Startup runs version-controlled migrations and an idempotent seed of four global Plans: Starter and Pro for Accounts; Basic and Premium for Users. A custom Plan belongs to exactly one Account. Plan assignment checks scope and owner. A definition update changes future decisions for every assigned entity in that Account. Counter rows are keyed by Account or User, not Plan, so a switch cannot reset usage or grant a fresh monthly allowance.

## Tenant boundary

The API key provides the Account identity. Every Account-scoped query uses that ID as a predicate, including external User lookup, custom Plan lookup, usage, and history. A foreign Account resource is treated as missing. Admin Account creation uses a separate Admin token. The service does not take an Account ID from a normal request body as an authority claim.

## Design choices

- PostgreSQL transactions and row locks keep both hard quotas and history consistent. Redis would add another state owner and a cross-system consistency problem without solving a requirement here.
- `READ COMMITTED` plus explicit locks permits concurrent configuration reads while serializing updates to the shared monthly counter. `SERIALIZABLE` would add abort/retry pressure without replacing a clear lock protocol.
- Keyset pagination avoids work that grows with page number, unlike `OFFSET`. It gives a stable ID order but not a frozen multi-page snapshot.
- Accounting is synchronous because permission is needed before the caller acts. An asynchronous counter could temporarily exceed a hard limit.
- The shared Account counter is a hot row under one Account's traffic. Correctness is the priority; performance work should be based on measured contention and reconciled totals.

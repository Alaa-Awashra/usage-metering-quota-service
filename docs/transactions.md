# Consumption transaction and concurrency

The reference implementation uses PostgreSQL `READ COMMITTED` transactions and row-level locks. One transaction contains the idempotency claim, the decision, both counter changes if accepted, and the final history row. A rollback leaves none of these committed. It does not perform an unprotected read/check/write sequence.

## Lock and decision order

1. Resolve the immutable User identity with an Account-scoped lookup, then `INSERT ... ON CONFLICT (account_id, request_id) DO NOTHING RETURNING id` claims a new request ID. The unique index makes a simultaneous duplicate wait for the first transaction's result. User Plan values are not read at this point.
2. If the claim did not insert, read the committed original decision. Identical Account, User, and units replay it with `replayed: true`; different immutable inputs return HTTP 409. A rejected decision is replayed unchanged, even after a Plan change.
3. Take `SELECT ... FOR SHARE` on the Account row. This is the configuration synchronization lock. Concurrent consumption may hold shared locks together.
4. Read the assigned Account and User Plans inside that lock. Capture one database `clock_timestamp()` after acquiring it and derive the UTC month once. A request waiting across midnight is assigned to the month in which it obtains the configuration lock.
5. Ensure zero-valued monthly rows exist, then lock the User monthly row `FOR UPDATE`, followed by the Account monthly row `FOR UPDATE`. These two rows are the usage serialization points. The same order is used by all consumption transactions.
6. Evaluate the pure rules in this order: User maximum per request, Account maximum per request, User monthly allowance, Account monthly allowance. Update both counters if accepted, or neither if rejected. A rejection is a completed business decision.
7. Store the outcome and its effective Plan limits and used-after values in `consume_requests`, then commit. Only after commit does the service send the HTTP response.

The zero-row insert must never insert the requested units before limit checking. With the reference approach, first-row creation still goes through the same locked evaluation as all later requests. Both counters and the history row commit together; a rejected Account rule cannot leave a User increment behind.

## Plan updates

Account Plan assignment, User Plan assignment, and updates to Account-owned custom Plan definitions lock the owning Account row `FOR UPDATE` before changing configuration. PostgreSQL makes that lock incompatible with consumption's `FOR SHARE` lock. Thus, a consumption admitted before the change finishes using one consistent Plan configuration, and one admitted after the change commits reads the new configuration. The Account lock is taken before configuration rows in mutation transactions. Consumption reads configuration before locking the User and Account counters; mutation transactions do not acquire counter locks. This avoids a counter-to-configuration lock cycle.

The history claim's foreign key takes a key-share lock on the Account before the explicit `FOR SHARE`. A Plan mutation can already be waiting for `FOR UPDATE`, so PostgreSQL may detect a lock-queue cycle in this claim-first protocol. The service retries the whole transaction at most twice after a deadlock (`40P01`) or serialization error (`40001`), with short bounded backoff. A retry uses a new transaction and makes a fresh claim attempt. Unexpected errors are not converted into business-rule rejections.

## Idempotency and failure

The unique `(account_id, request_id)` index is the arbiter. A concurrent duplicate cannot pass the claim step while the first transaction is still unresolved. If the first commits, the second replays its final snapshot. If it rolls back, another attempt may claim and process the ID. A process crash after commit but before the HTTP response is handled by retrying the same ID. The retry returns the committed decision and consumes no additional units.

The request ID is scoped to an Account. Reusing it with another User or units is a conflict, even if the current Plan would permit that new request. A caller must choose a new ID for a logically new action.

## Month and history ordering

The captured processing timestamp supplies one UTC month for both counters and history. Previous monthly rows remain. A replay uses the original month and snapshots. History IDs come from a sequence and are useful for descending keyset pagination; sequence allocation order and commit order can differ. Pagination therefore offers a best-effort view of committed rows, not an immutable snapshot across page requests.

## Independent integrity check

For each Account and month, `account_monthly_usage.used` must equal the sum of `units` for accepted `consume_requests`. For each User and month, `user_monthly_usage.used` must equal the corresponding accepted sum. Missing counter rows and missing accepted requests both represent zero. Reconciliation must query the real PostgreSQL database; tests and load runs should fail when either equality is broken.

## PostgreSQL references

The [PostgreSQL 17 row-lock compatibility table](https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS) confirms that `FOR SHARE` locks coexist while `FOR UPDATE` conflicts with them. The [transaction-isolation documentation](https://www.postgresql.org/docs/17/transaction-iso.html) explains `READ COMMITTED` behavior. The [INSERT documentation](https://www.postgresql.org/docs/17/sql-insert.html) defines `ON CONFLICT`. These facts are used in the protocol above rather than assumed from SQL syntax alone.

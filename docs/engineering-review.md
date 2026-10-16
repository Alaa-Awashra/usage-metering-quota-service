# Engineering review

This project connects the course topics directly: Git tracks schema and code changes; TypeScript models valid requests and decisions; the Express server exposes HTTP routes; the example client uses Node's `fetch`; SQL enforces uniqueness and atomicity; Docker Compose runs the API beside PostgreSQL. The pure quota evaluator follows the same functional-programming principle practiced earlier: given the same Plans, used amounts, and units, it returns the same decision without side effects.

## One request, end to end

```text
POST /v1/consume
  -> parse Authorization: ApiKey and find the Account by key digest
  -> validate userId, units, and requestId
  -> begin PostgreSQL transaction
  -> claim (account_id, request_id) in unique-indexed history
  -> lock Account FOR SHARE and read effective Plans
  -> capture database processing time and UTC month
  -> lock User then Account monthly counters
  -> evaluate User and Account rules
  -> update both counters or neither
  -> finalize history with the decision snapshot
  -> COMMIT
  -> return JSON
```

1. **Why monthly counters instead of summing history?** A counter lookup is bounded by one Account or User and month. Summing an ever-growing history on every request makes the hot path slower and harder to lock. History is retained for audit, replay, and reconciliation.
2. **What prevents two requests from overspending?** Both lock the same relevant monthly counter rows. One completes its update before the other reads the locked value and evaluates the allowance.
3. **What if two requests use one ID?** The unique `(account_id, request_id)` index allows one transactional claim. The other waits, then replays the committed result if inputs match or receives HTTP 409 if they differ.
4. **What if the transaction rolls back?** The claim, counter changes, and decision row all roll back. A later retry can process the ID.
5. **What if the server crashes after commit?** The caller can retry with the same ID. The server returns the persisted snapshot without consuming again.
6. **How are both limits enforced?** One accepted transaction increments one User counter and the shared Account counter. It is accepted only if all four rules pass.
7. **How does a Plan modification affect usage?** It changes the effective limits of future decisions; it does not change existing counter keys or rewrite decisions.
8. **What if a limit drops below used?** Used remains intact, remaining is clamped to zero, and new requests are rejected until the available allowance is sufficient again.
9. **How are concurrent Plan modifications handled?** Consumption holds an Account-row `FOR SHARE` lock while reading and applying configuration. Mutations take `FOR UPDATE` on that row. Incompatible locks order the two operations.
10. **Why `READ COMMITTED`?** Explicit row locks provide the required serialization for Plans and counters while allowing independent Accounts and shared configuration readers to proceed. `SERIALIZABLE` would add aborts without eliminating the need for a clear mutation protocol.
11. **Row locking versus optimistic concurrency?** Row locking waits before acting on shared state. Optimistic concurrency checks a version or predicate at write time and retries on conflict. This implementation uses row locking for a readable baseline.
12. **What causes a hot Account row?** Every accepted User request under one Account updates the same Account-month counter, so those updates must take turns.
13. **What runs while that row is locked?** The transaction evaluates the final rule result, updates counters if accepted, finalizes the decision, and commits. It does not make external HTTP calls under the lock.
14. **Why no Redis?** PostgreSQL already owns the counters and history. A Redis hard-quota check would need a separate consistency protocol to commit with PostgreSQL.
15. **What does idempotency guarantee?** A committed request ID yields one recorded decision and at most one consumption. It does not make the caller's action outside this service atomic with metering.
16. **Why hash API keys?** A database disclosure should not reveal reusable raw credentials. Uniformly random 32-byte keys permit SHA-256 as a lookup digest.
17. **How are Accounts isolated?** Authentication provides the trusted Account ID, and scoped SQL predicates and Plan ownership checks use it for every Account resource.
18. **What happens at a UTC month boundary?** The transaction selects a single database time after configuration locking. Both counters and history use that UTC month. A lock wait crossing midnight places the decision in the new month.
19. **How are totals verified independently?** Sum accepted history units per Account/month and User/month in PostgreSQL and compare with each counter. Rejected rows contribute zero.
20. **What is the next scaling step?** First measure lock duration and SQL round trips. If one Account's write contention becomes a proven bottleneck, evaluate a guarded conditional UPSERT under the same Plan lock and integrity tests. A strict shared hard limit still has a serialization point.

## Advanced SQL features used

- `ON CONFLICT DO NOTHING RETURNING` atomically claims a request ID and lets a conflicting transaction settle before replay.
- `FOR SHARE` allows multiple consumers to read one stable Account configuration while blocking incompatible Plan mutation locks.
- `FOR UPDATE` serializes counter reads and writes, and orders configuration mutation against consumption.
- `BIGINT` and nonnegative constraints prevent counter sign errors. Public values are restricted to safe JSON integers.
- A unique index on `(account_id, request_id)` is the database-level idempotency guarantee.

These features solve explicit requirements; there is no cache, message bus, dependency injection framework, or second service.

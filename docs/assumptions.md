# Product assumptions and reasons

The original assignment intentionally leaves some product decisions open. The following choices are explicit and consistently implemented in the single TypeScript API and PostgreSQL database.

| Decision | Chosen behavior | Reason |
| --- | --- | --- |
| One resource | Each action consumes a positive integer number of document-processing credits (units). | The brief requires one resource; a single integer model keeps admission atomic and easy to audit. |
| Account provisioning | An operator with a separate Admin token creates Accounts and receives a new API key once. | Avoids exposing unrestricted Account creation to anonymous callers. Account users cannot cross the tenant boundary. |
| Key storage | Generate 32 random bytes; persist only the SHA-256 digest. | A database reader does not obtain usable plaintext API keys. Key rotation is deliberately out of scope. |
| User identity | External User ID is unique within, not across, Accounts; end users do not log in to this service. | The calling application's backend is the authenticated actor; it owns its User identifiers. |
| Plans | Four globally visible, read-only predefined Plans, plus mutable Account-owned custom Plans of Account or User scope. | Fits the requested default and customizable modes while preventing one Account from changing another Account's configuration. |
| Limits | Monthly allowances may be zero; per-request maxima must be positive. Public numeric fields must be JavaScript safe integers. | Zero allowance provides an explicit disabled state; safe integers avoid silent JSON precision loss. |
| Multiple rule failures | Evaluate User maximum per request, Account maximum per request, User monthly allowance, then Account monthly allowance. Return the first blocking rule. | The caller receives one stable, deterministic reason even if multiple rules fail. |
| Business rejection | Respond HTTP 200 with `accepted: false` and the identified rule, and save the decision. | A quota rejection is a successfully processed decision, not a malformed API call. |
| Transaction and retry | Persist an Account-scoped `(account_id, request_id)` idempotency claim, decision, and both counters in one PostgreSQL transaction. Same inputs replay the original decision; changed User or units return 409. | Prevents double charging when the client retries after a lost response or under concurrency. |
| Clock/month | Use the PostgreSQL processing timestamp after configuration synchronization and derive the UTC calendar month; keep prior months queryable. | The database is the authority for month boundaries; waiting across midnight takes the month at actual decision processing. |
| Plan change | Switch or edit Plans without resetting counters. When usage is already above the new limit, display zero remaining and reject subsequent consumption at that scope. | Prevents accidental grant of a fresh allowance. Preserve decision-time limits in history. |
| Historical usage | Historical counters are paired with the *current* assigned Plan's limit for display; the past request's original limits remain in its history snapshot. | Counter history stays immutable without versioning every assignment for read-side history. |
| Pagination | Descending keyset pagination by request row ID, up to 100 items. Concurrent inserts may change which rows are visible across pages. | Efficient, predictable paging without requiring a long-held database snapshot. |
| Example client | A one-shot TypeScript CLI runs automatically as the third Compose service; it exits successfully after demonstrating the required cases. | Satisfies complete-stack startup while keeping the production service and database running. |
| Scope limits | No billing, refunds, multi-resource accounting, end-user authentication, or distributed deployment. | These are explicitly outside the assignment. |

Details about tradeoffs and residual risks are in [architecture](architecture.md), [transactions](transactions.md), and [limitations](limitations.md).

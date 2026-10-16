# Assumptions and decisions

The workspace contained an unrelated static web template and no original assignment brief. The service lives in `usage-metering-quota-service/` so that existing files remain untouched. The implementation prompt in this conversation is the available product brief.

The later training curriculum amendment takes precedence over earlier tool choices where they conflict. All custom application code and test utilities use TypeScript. Validation uses small explicit TypeScript functions, and tests use `node:test` unless an implementation need calls for Vitest. SQL, JSON, YAML, Dockerfiles, and Markdown remain appropriate for schema, configuration, and documentation.

One unit is an indivisible positive integer. Public JSON numeric amounts and limits are capped at JavaScript's maximum safe integer; PostgreSQL stores counters and limits as `BIGINT`. Neither Account nor User monthly usage resets on a Plan switch. The UTC month is selected once by the server inside the protected consumption transaction.

An Account API key identifies one tenant. The service does not authenticate end users. An external user ID is unique only within its Account. The same external ID may appear in separate Accounts.

Predefined Plans are global and immutable. Custom Plans are visible only to their owning Account. Changes to a Plan definition take effect for future decisions; existing usage and decision snapshots remain unchanged.

A quota rejection is a completed decision returned with HTTP 200. Input errors, authentication failures, missing resources, and idempotency conflicts use their respective HTTP error statuses. A retry with the same request ID and identical immutable inputs returns the original decision, even if the Plan or month has changed.

History pagination uses descending database-generated request IDs. Such IDs make a stable keyset order but do not guarantee commit order. Pagination is a best-effort view of committed records, not a database snapshot held across requests.

No payment processing, key rotation API, distributed cache, or asynchronous metering is part of this assignment.

# Security review — pre-submission phase 3

This is a review of the project as a local training/demo service, not a production penetration test.

## Observed protections

- Admin authentication and account authentication use separate credentials.
- API keys are generated from `randomBytes(32)` and stored as SHA-256 digests.
- All SQL queries involving request data in `service/src` use PostgreSQL positional parameters; Drizzle is used to define a static schema.
- Effective account identity is obtained from the API key, not a client-supplied account ID.
- Custom-plan visibility and user queries are scoped to the authenticated account.
- The JSON parser enforces a 16 KiB body limit.
- PostgreSQL is bound to the host loopback interface for local development.

## Local deployment restriction — applied

The *host-facing API port* is already bound to `127.0.0.1` in `docker-compose.yml`. Docker clients still use `http://api:3000` internally. The configured `api.ports` line is:

```yaml
- "127.0.0.1:${API_HOST_PORT:-3000}:3000"
```

Do not use this Compose deployment unchanged as a public Internet service: sample database username and password are intended for local development only. Production requires TLS/reverse proxy, credential management, least-privilege database access, and other controls beyond the original brief.

## npm audit findings and scope

- `drizzle-orm@0.44.6` is within the affected range of GHSA-gpj5-g38j-94v9 (patched at `0.45.2` and later in the 0.x line). The advisory requires attacker-controlled SQL identifier/alias construction. Current `service/src` code does not construct identifiers from user input (`sql.identifier()`, `.as()`); application SQL calls use `$1`, `$2`, etc. This substantially limits exposure to the reported injection route, but it is **not** a security patch and does not clear the advisory. Upgrade to a patched Drizzle ORM release in a separate compatibility-verified dependency change before public deployment.
- The `esbuild <=0.24.2` finding is reached through Drizzle Kit development tooling, not the production API runtime. Avoid exposing development servers to untrusted networks. Fix through vetted dependency updates, not an automatic forced major upgrade.
- The previously reported local Node.js version 24.14.1 predates the Oct 21, 2026 security release 24.22.1. Updating the host runtime and rebuilding Docker images using a current patched version is recommended. Do not assume a floating `node:24-alpine` tag is automatically updated in an already-running container.

Official references:
- https://github.com/advisories/GHSA-gpj5-g38j-94v9
- https://github.com/advisories/GHSA-67mh-4wv8-2f99
- https://nodejs.org/en/blog/vulnerability/october-2026-security-releases

## New API security regression tests

`service/test/security/boundaries.test.ts` checks authentication across protected groups, SQL-injection-shaped input as data, tenant isolation against account-ID spoofing and foreign plans, and safe failures for malformed or oversized JSON.

Run these against a dedicated `_test` PostgreSQL database. Passing the tests supports the examined behaviors; it does not establish that every possible security issue has been eliminated.

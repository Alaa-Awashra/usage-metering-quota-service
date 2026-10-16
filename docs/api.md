# HTTP API

All endpoints use JSON. The normal Account credential is `Authorization: ApiKey <key>`. Account creation uses `X-Admin-Token: <token>` instead. Set shell variables for the examples:

```bash
export API_BASE_URL=http://localhost:3000
export ADMIN_TOKEN='your-local-admin-token'
export API_KEY='the-key-returned-by-account-creation'
export USER_PLAN_ID='a-uuid-from-v1-plans'
export ACCOUNT_PLAN_ID='a-uuid-from-v1-plans'
export CUSTOM_PLAN_ID='the-id-returned-by-custom-plan-creation'
```

An Account key is returned only by `POST /admin/accounts`. Save it securely before leaving that response. Do not put it in source control. Normal Account endpoints never return it again. In the examples below, `-H "Authorization: ApiKey $API_KEY"` identifies the Account; a body `accountId` is never used for authorization.

## Health

`GET /healthz` reports process liveness. `GET /readyz` reports readiness after database initialization.

```bash
curl -s "$API_BASE_URL/healthz"
curl -s "$API_BASE_URL/readyz"
```

## Accounts

Create an Account by choosing a predefined Account Plan name. The Admin token is independent of Account API keys.

```bash
curl -s -X POST "$API_BASE_URL/admin/accounts" \
  -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"demo-co","planName":"Starter"}'
```

The response contains `id`, `name`, `plan`, and `apiKey`. The last field contains the newly generated secret only on this endpoint.

```bash
curl -s "$API_BASE_URL/v1/account" -H "Authorization: ApiKey $API_KEY"
curl -s -X PUT "$API_BASE_URL/v1/account/plan" \
  -H "Authorization: ApiKey $API_KEY" -H 'Content-Type: application/json' \
  -d "{\"planId\":\"$ACCOUNT_PLAN_ID\"}"
```

`GET /v1/account` includes the current applied Plan and UTC-month usage. `PUT /v1/account/plan` returns `{ "planId": "..." }`. The switch preserves the Account's current and historical counters.

## Plans

```bash
curl -s "$API_BASE_URL/v1/plans" -H "Authorization: ApiKey $API_KEY"
curl -s -X POST "$API_BASE_URL/v1/plans" \
  -H "Authorization: ApiKey $API_KEY" -H 'Content-Type: application/json' \
  -d '{"name":"Small team","scope":"user","monthlyLimit":300,"maxPerRequest":30}'
curl -s "$API_BASE_URL/v1/plans/$USER_PLAN_ID" -H "Authorization: ApiKey $API_KEY"
curl -s -X PATCH "$API_BASE_URL/v1/plans/$CUSTOM_PLAN_ID" \
  -H "Authorization: ApiKey $API_KEY" -H 'Content-Type: application/json' \
  -d '{"monthlyLimit":500,"maxPerRequest":40}'
```

`GET /v1/plans` returns an array containing four global predefined Plans and this Account's custom Plans. Creation returns a Plan with an `id`, `ownerAccountId`, `scope`, `name`, `monthlyLimit`, and `maxPerRequest`. `GET /v1/plans/:id` returns one visible Plan. `PATCH` is allowed only for a custom Plan owned by the authenticated Account; set `CUSTOM_PLAN_ID` from the create response. A foreign Plan is treated as missing. A predefined Plan is read-only.

The four seeded Plans are:

| Scope | Name | Monthly limit | Maximum per request |
| --- | --- | ---: | ---: |
| Account | Starter | 10,000 | 100 |
| Account | Pro | 100,000 | 500 |
| User | Basic | 1,000 | 20 |
| User | Premium | 5,000 | 100 |

## Users

The `:userId` path value is the external User ID supplied by the calling application. It is scoped to the authenticated Account.

```bash
curl -s -X POST "$API_BASE_URL/v1/users" \
  -H "Authorization: ApiKey $API_KEY" -H 'Content-Type: application/json' \
  -d "{\"externalId\":\"ahmad\",\"planId\":\"$USER_PLAN_ID\"}"
curl -s "$API_BASE_URL/v1/users/ahmad" -H "Authorization: ApiKey $API_KEY"
curl -s -X PUT "$API_BASE_URL/v1/users/ahmad/plan" \
  -H "Authorization: ApiKey $API_KEY" -H 'Content-Type: application/json' \
  -d "{\"planId\":\"$USER_PLAN_ID\"}"
```

The create response returns the User's internal `id`, `externalId`, and `planId`. The read response also includes the applied Plan and current monthly usage. Assignment requires a User-scope global Plan or one owned by this Account. A Plan switch does not reset usage.

## Consumption

```bash
curl -s -X POST "$API_BASE_URL/v1/consume" \
  -H "Authorization: ApiKey $API_KEY" -H 'Content-Type: application/json' \
  -d '{"userId":"ahmad","units":10,"requestId":"doc-123"}'
```

An accepted decision uses HTTP 200:

```json
{
  "requestId": "doc-123",
  "accepted": true,
  "replayed": false,
  "rejection": null,
  "account": {"used": 10, "limit": 10000, "remaining": 9990},
  "user": {"used": 10, "limit": 1000, "remaining": 990}
}
```

A rule rejection is also a processed decision with HTTP 200:

```json
{
  "requestId": "doc-124",
  "accepted": false,
  "replayed": false,
  "rejection": {"level": "user", "rule": "max_per_request", "limit": 20},
  "account": {"used": 10, "limit": 10000, "remaining": 9990},
  "user": {"used": 10, "limit": 1000, "remaining": 990}
}
```

The rule order is User maximum per request, Account maximum per request, User monthly allowance, Account monthly allowance. The first blocker is returned. Remaining is never negative, even after a Plan limit is reduced. Reusing `doc-123` with identical immutable inputs returns the original response with `replayed: true`; changing User or units with the same ID returns HTTP 409. A rejected request is also replayed, not reevaluated.

## Usage

The `month` query is an optional UTC `YYYY-MM`; omission selects the current UTC month. A month with no counter row has zero usage.

```bash
curl -s "$API_BASE_URL/v1/usage?month=2026-10" -H "Authorization: ApiKey $API_KEY"
curl -s "$API_BASE_URL/v1/users/ahmad/usage?month=2026-10" \
  -H "Authorization: ApiKey $API_KEY"
```

These endpoints report the selected entity's `used`, current Plan `limit`, and clamped `remaining` for that month. A historical query keeps the historical counter but applies the currently assigned Plan for its displayed remaining amount. Decision-time limits are retained in request history.

## Request history

History includes both accepted and rejected final decisions. Use a bounded `limit` and pass the returned `nextCursor` to the next request. `userId` is optional and filters by this Account's external User ID.

```bash
curl -s "$API_BASE_URL/v1/requests?limit=20" -H "Authorization: ApiKey $API_KEY"
curl -s "$API_BASE_URL/v1/requests?userId=ahmad&limit=20" \
  -H "Authorization: ApiKey $API_KEY"
curl -s "$API_BASE_URL/v1/requests?limit=20&cursor=123" \
  -H "Authorization: ApiKey $API_KEY"
```

The response shape is `{ "items": [...], "nextCursor": "..." }`, with `nextCursor: null` at the end. Each item includes the decision outcome, rejection, month, decision-time Plan limits, and used-after counter snapshots. Items are ordered by descending database request ID. That ID is allocated before commit, so a concurrent transaction can commit out of ID order. Pagination is a best-effort committed view rather than a frozen snapshot.

## Errors and validation

| Status | Meaning |
| --- | --- |
| 400 | Malformed JSON, invalid field, month, UUID, cursor, or page size. |
| 401 | Missing, malformed, or invalid Account or Admin credential. |
| 404 | Resource absent or outside the authenticated Account. |
| 409 | Duplicate request ID with different immutable inputs or another resource conflict. |
| 503 | Database unavailable or a bounded transaction retry exhausted. Retry with the same request ID. |
| 500 | Unexpected server or database failure. |

Units and limits are JSON numbers that must be safe integers, with requested units positive. Input text has explicit maximum lengths. Error responses are structured and do not include raw API keys, database credentials, or SQL internals.

# Limitations

- One metered resource type: integer units.
- One PostgreSQL database. The shared Account counter is a serialization point under heavy traffic from the same Account. This is the price of a strict shared hard quota.
- No API key rotation or self-service revocation endpoint. A key is displayed when the Account is created and stored as a SHA-256 digest.
- Request history grows indefinitely; an operational retention and archival policy would be needed for long-running deployments.
- History pagination follows request IDs, which are allocated before commit. Concurrent transactions may commit in another order, so a multi-page traversal does not provide a frozen snapshot.
- This service decides whether an action may consume units and records that decision. It cannot make the caller's subsequent business action atomic with the quota decision. Callers should use stable request IDs for retries and decide how to handle an action that fails after an accepted consumption.
- Billing, pricing, payment collection, multi-region replication, and a distributed deployment are outside the project scope.

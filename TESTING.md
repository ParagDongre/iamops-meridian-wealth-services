# Testing & Verification Guide

## Running Automated Tests
```bash
npm run lint
npm test
```

## Coverage in `tests/iamops.test.ts`
The Vitest + Supertest integration suite executes against an isolated in-memory relational database and verifies:
1. Production safe-startup secret guard (`ENV=prod` rejects weak secrets).
2. Unauthenticated request blocking (`401`) and real JWT token revocation on logout.
3. 5-failure account lockout (`423`) and IAM Admin unlock recovery.
4. OIDC PKCE SSO authorization code exchange and TOTP MFA enrollment + login enforcement.
5. Backend RBAC enforcement (Auditors blocked with `403` from mutating identities or catalog).
6. Catalog Admin CRUD (Applications, Entitlements, Business Roles).
7. Identity creation, modification, Joiner, Mover, and Leaver zero-privilege-retention verification.
8. SoD violation blocking (`409 Conflict`), multi-stage approval gating, and rejected request isolation.
9. Provisioning failure handling, auto-incident creation, retry recovery, and idempotent re-execution.
10. SLA breach sweep, Access Certification revocation auto-deprovisioning, and immutable audit trigger/hash-chain verification.

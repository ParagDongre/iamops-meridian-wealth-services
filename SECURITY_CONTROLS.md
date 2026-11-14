# Security Controls & Production Hardening

## Implemented Technical Controls
1. **Password Storage**: Salted `scrypt` (`crypto.scryptSync` + `crypto.timingSafeEqual`).
2. **Login Protection**: Per-IP sliding-window rate limiting (15 attempts/min) + 5-failure account lockout (15-min lock + IAM Admin unlock).
3. **Session Security**: HMAC-SHA256 JWTs with 30-minute expiration, unique `jti`, and database-backed token revocation blocklist (`revoked_tokens`).
4. **Multi-Factor Authentication**: RFC 6238 Base32 TOTP 6-digit MFA enrollment & verification.
5. **OIDC PKCE SSO**: S256 PKCE authorization code flow supporting external Keycloak or embedded Meridian IdP consent.
6. **Safe Startup**: When `ENV=prod`, startup aborts if `JWT_SECRET` or `MFA_ENCRYPTION_KEY` is missing, shorter than 32 characters, or matches a placeholder value. API docs (`/api/openapi.json`) are disabled in production.
7. **Immutable Audit Trail**: SHA-256 hash chain across `audit_events` protected by `BEFORE UPDATE` and `BEFORE DELETE` SQLite abort triggers.
8. **HTTP Hardening**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `X-Request-Id` correlation, and structured JSON logging without leaking stack traces.

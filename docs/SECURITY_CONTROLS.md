# Security Controls
**Implemented**: bcrypt hashes; JWT auth (60 min); secrets from environment only; backend RBAC with audited denials; Pydantic validation; generic login errors; no self-approval/self-review; terminated users cannot be reactivated; append-only audit (ORM guard tested; PostgreSQL trigger written but NOT verified); CSV export neutralises formula injection.
**Not claimed**: regulatory compliance (SOX, GDPR, etc.). Audit logs are evidence of implemented controls only.
**Before production**: TLS, Keycloak production mode, secrets manager, rate limiting/lockout, MFA, token revocation, Alembic migrations, backups, log shipping, Keycloak SSO for the UI, change the demo password.

# Deployment (single host, Docker)
Prereqs: Linux VM (2 vCPU/4 GB+), Docker, two DNS names (APP_DOMAIN, KC_DOMAIN) pointing at it, ports 80/443 open.
1. `cp .env.prod.example .env` and fill every secret (generate with `secrets.token_urlsafe(32)`). App refuses to start in `ENV=prod` with short/placeholder secrets or SQLite.
2. `docker compose -f docker-compose.prod.yml up -d --build` (API runs Alembic migrations on start; Caddy obtains TLS certificates automatically).
3. First admin: `docker compose -f docker-compose.prod.yml run --rm api python -m backend.app.bootstrap` (uses BOOTSTRAP_ADMIN_* from .env). Remove the password from .env afterwards.
4. Open `https://APP_DOMAIN`, sign in, then create roles/apps (catalog currently loaded via `backend/app/seed.py` logic — see Remaining work).
Only Caddy is published; Postgres, LDAP, API are internal. API docs are disabled in prod (`ENABLE_DOCS`).
Backups: `docker compose exec postgres pg_dump -U $POSTGRES_USER $POSTGRES_DB > backup.sql` (schedule it; test restores).
Upgrades: `git pull && docker compose -f docker-compose.prod.yml up -d --build`.
## Remaining work before calling it production-ready
UI SSO via Keycloak/OIDC (currently local passwords + lockout), MFA, token revocation, admin UI/API for roles/apps/SoD catalog, delegation/approver escalation, load + security testing, off-host backups and monitoring, verification of connectors and the PG audit trigger on a live stack.

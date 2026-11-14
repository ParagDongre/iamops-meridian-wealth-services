# IAMOps — Enterprise Identity & Access Management Operations Lab

**IAMOps** is an enterprise Identity & Access Management (IAM) Operations simulation built for a fictional financial services firm, **Meridian Wealth Services**.

## Login Credentials (Development / Lab Mode)

On initial startup, the console starts **clean with zero sample figures** across every operational screen so you can either build from scratch or load the test dataset (`data/dummy-data.json`).

| Username | Password | Role | Permissions |
| --- | --- | --- | --- |
| `iam.admin` | `MeridianAdmin!2026` | `iam_admin` | Full access: Catalog Admin, Operator Unlock, Load/Clear Dummy Data, JML, Approvals, Provisioning, Tickets, Certifications, Audit |
| `iam.analyst` | `MeridianAnalyst!2026` | `iam_analyst` | Identity CRUD, JML workflows, Access Requests, Provisioning Queue, Tickets, SLA Sweeps |
| `wealth.manager` | `MeridianManager!2026` | `manager` | Submit requests, Approve/Reject manager stage, Launch & review Access Certifications |
| `app.owner` | `MeridianOwner!2026` | `app_owner` | Approve/Reject application owner stage, Review Access Certifications |
| `compliance.auditor` | `MeridianAuditor!2026` | `auditor` | Read-only operational visibility, Access Certification campaigns/reviews, Audit chain verification, CSV exports |

> **Production Note (`ENV=prod`)**: Demo credentials and quick-fill accounts are automatically disabled in production. Only `iam.admin` is bootstrapped using `BOOTSTRAP_ADMIN_PASSWORD`.

## Testing with Dummy Data (`data/dummy-data.json`)

Every screen starts with `0` records by default. To populate realistic test data:
1. Sign in as `iam.admin`.
2. Go to **System Configuration** (or click **Load Dummy Data** on the **Executive Overview** empty banner).
3. You can:
   - Click **Load `data/dummy-data.json`** to populate 14 employees, 6 apps, 16 entitlements, 7 roles, 4 SoD policies, access requests, work items, tickets, certifications, and audit logs.
   - Click **Download `dummy-data.json`** to inspect or customize the JSON test file locally, then re-upload it via **Import Custom Dummy JSON**.
   - Click **Clear All Data** at any time to wipe operational & catalog tables back to `0`.

## Implemented Capabilities
1. **Workforce Identity Directory**: Search, filter, create, update, activate/deactivate identities with full lifecycle history.
2. **Joiner / Mover / Leaver (JML)**: End-to-end onboarding, department/role transfer entitlement diffing, and zero-privilege-retention termination safeguards.
3. **RBAC & Segregation of Duties (SoD)**: Backend-enforced role-to-entitlement mappings and dual-control conflict blocking.
4. **Access Request & Multi-Stage Approvals**: Manager → Application Owner → Compliance gates with duplicate detection and SLA deadlines.
5. **Provisioning Orchestration Queue**: SailPoint-inspired idempotent work items, retry/escalation handling, failure simulation, and live Keycloak IdP & OpenLDAP synchronization.
6. **Application & Catalog Admin**: Full CRUD UI & API for Applications, Entitlements, Business Roles, Directory Groups, and SoD Policies.
7. **ITSM Ticketing Simulation**: Custom ServiceNow-inspired Incidents, Service Requests, and Operational Tasks linked to provisioning failures and SLA breaches.
8. **Access Certification**: Periodic manager/owner attestation campaigns where revocations automatically dispatch deprovisioning work items.
9. **Immutable Hash-Chained Audit Log**: Append-only SHA-256 hash-chained `audit_events` protected by SQLite `BEFORE UPDATE` / `BEFORE DELETE` abort triggers, with CSV evidence exports.
10. **Authentication Hardening**: Scrypt password hashing, 5-attempt account lockout, per-IP login rate limiting, 30-minute revocable JWTs, RFC 6238 TOTP MFA, and OIDC PKCE SSO.

## Quick Start (Local Development)
```bash
npm install
npm run dev
```
Open `http://localhost:3000`.

## Verification Commands
```bash
npm run lint   # TypeScript type-checking
npm test       # Vitest + Supertest integration suite
npm run build  # Production Vite client bundle
```

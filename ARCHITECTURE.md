# System Architecture — IAMOps

## Logical Components
- **A. IAM Operations Dashboard**: React + Tailwind v4 SPA (`src/App.tsx`, `src/components/*`) communicating exclusively over authenticated REST APIs (`/api/*`).
- **B. Identity Management Service**: Manages authoritative `identities` records separately from `app_accounts`, `business_roles`, `directory_groups`, and `identity_entitlements`.
- **C. Access Request & Approval Engine**: Sequential multi-stage workflow (`Submitted -> Pending Approval -> Approved / Rejected -> Provisioning -> Fulfilled / Failed`).
- **D. Provisioning Orchestration Engine**: Idempotent work-item queue (`provisioning_work_items`) with `idempotency_key`, retry tracking, L2 escalation, and automated ITSM Incident creation on failure.
- **E. Application & Catalog Registry**: Full Catalog Admin API & UI for managing enterprise apps, entitlements, roles, groups, and SoD policies.
- **F. Ticket Management Service**: Custom ITSM simulation (`tickets`, `ticket_comments`) for Incidents, Service Requests, and Tasks.
- **G. Access Certification Engine**: Periodic review campaigns (`certification_campaigns`, `certification_items`) that trigger live revocation work items.
- **H. Audit & Compliance Service**: Hash-chained `audit_events` enforced by database immutability triggers (`prevent_audit_update`, `prevent_audit_delete`).
- **I. SLA & Operations Reporting**: Live KPI aggregation and scheduled/on-demand `runSlaSweep()` breach scanner.
- **J. Keycloak Identity Provider**: Configurable external Keycloak OIDC PKCE + Admin REST integration, with an embedded Meridian IdP OIDC Consent & `idp_accounts` store for standalone execution.
- **K. OpenLDAP Directory**: Tracks distinguished names (`uid=...,ou=...,ou=people,dc=meridian,dc=internal`), `memberOf` group memberships, and `ns_account_lock`.
- **L. Persistent Relational Database**: 22 normalized SQL tables initialized via `src/server/db.ts`.

## Data Flow
1. HR / IAM Operator triggers Joiner, Mover, Leaver, or Access Request via the UI or REST API.
2. Backend validates input (Zod), checks RBAC permissions (`requireRole`), and evaluates `evaluateSodForIdentity()`.
3. Approved requests enqueue idempotent `provisioning_work_items`.
4. `executeConnectorAction()` updates target `app_accounts`, `identity_entitlements`, `idp_accounts` (Keycloak), and `ldap_entries` (OpenLDAP).
5. Every state transition appends a SHA-256 chained event to `audit_events`.

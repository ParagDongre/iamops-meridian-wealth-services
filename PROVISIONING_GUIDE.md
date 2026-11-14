# Provisioning Orchestration & Connector Guide

## Idempotent Work-Item Execution
Every approved access request, certification revocation, or JML action creates a row in `provisioning_work_items` with a unique `idempotency_key`.
- Calling `POST /api/provisioning/work-items/:id/execute` on an already `Fulfilled` work item returns `idempotentSkip: true` without duplicating accounts or entitlements.

## Failure Handling & Incident Escalation
- You can toggle **Outage Simulated (ON)** on any application in **App & Catalog Admin**.
- When a target connector rejects provisioning, `processWorkItem()` never silently marks it successful:
  1. Increments `retry_count` and stores `error_details`.
  2. Automatically creates a linked high-priority ITSM **Incident** (`INC-...`) if none exists.
  3. Auto-escalates to L2 (`escalated_to_l2 = 1`) once `retry_count >= max_retries`.

## Keycloak & OpenLDAP Integration
- When `KEYCLOAK_URL`, `KEYCLOAK_ADMIN_USER`, and `KEYCLOAK_ADMIN_PASSWORD` are configured, `syncKeycloakIdentity()` executes real Admin REST API calls against `/admin/realms/{realm}/users`.
- Otherwise, the embedded `idp_accounts` and `ldap_entries` stores persist full Keycloak user IDs, realm roles, LDAP distinguished names (`uid=...,ou=...,dc=meridian,dc=internal`), `memberOf`, and `nsAccountLock`.

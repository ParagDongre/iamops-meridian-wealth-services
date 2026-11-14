# IAM Concepts & SailPoint / ServiceNow Mapping

## Strict Entity Separation
IAMOps separates distinct IAM concepts into dedicated tables rather than conflating them:
- **Identity (`identities`)**: The human workforce record (`EMP-1002 · Julian Mercer`).
- **Account (`app_accounts`, `idp_accounts`, `ldap_entries`)**: Technical login representations on target systems.
- **Business Role (`business_roles`)**: Job-function bundle (e.g., `Wealth Advisor`) mapped to baseline entitlements.
- **Directory Group (`directory_groups`)**: AD/LDAP security group (`cn=wealth-advisors,ou=groups,dc=meridian,dc=internal`).
- **Entitlement (`entitlements`)**: Fine-grained permission inside an application (`WMP_TRADE_INITIATE`).
- **Access Request (`access_requests`)** & **Approval Record (`approval_records`)**: Governance request and per-stage approver decisions.
- **Provisioning Work Item (`provisioning_work_items`)**: Technical execution unit dispatched after approvals complete.
- **Audit Event (`audit_events`)**: Immutable compliance evidence record.

## Industry Equivalents
- **SailPoint IIQ / IdentityNow**: Modeled via our Provisioning Work-Item Queue, Identity Cube inspection drawer, Access Certification campaigns, and SoD Policy Engine.
- **ServiceNow ITSM**: Modeled via our custom ITSM Ticket Management module (`INC-`, `SR-`, `TASK-`) with SLA deadlines and escalation history.
- **Keycloak & OpenLDAP**: Modeled with real OIDC PKCE login + Admin REST adapter and persistent `idp_accounts` / `ldap_entries` stores.

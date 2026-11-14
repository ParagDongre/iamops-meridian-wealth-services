# Known Limitations
- Keycloak/LDAP connectors never run against live servers by the author of this build.
- No migrations: schema changes need `docker compose down -v` and re-seed.
- No background scheduler: SLA sweep is manual/API-triggered.
- UI uses local bcrypt passwords, not Keycloak SSO.
- Single compliance approver; no delegation.
- Streamlit UI has no automated tests. Screenshots: run the app, Win+Shift+S, save to docs/screenshots/.
- SailPoint, ServiceNow and Active Directory are conceptual simulations only.

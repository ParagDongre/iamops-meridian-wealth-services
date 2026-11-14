# Known Limitations & Scope Boundaries

1. **Single-Host SQLite Persistence**: The default runtime uses local SQLite with WAL mode (`./data/iamops.db`). Multi-region active-active clustering would require migrating the SQL layer to managed PostgreSQL.
2. **External Keycloak / OpenLDAP**: In standalone mode without `KEYCLOAK_URL` and `LDAP_URL`, IdP and directory mutations are persisted in local `idp_accounts` and `ldap_entries` tables and OIDC uses the built-in Meridian IdP PKCE consent endpoint. Live external Keycloak Admin REST calls activate when `KEYCLOAK_URL` and admin credentials are provided.
3. **Simulated ITSM & SailPoint Patterns**: Tickets and provisioning work items model enterprise ServiceNow and SailPoint IIQ workflows locally; they do not call commercial SaaS APIs.
4. **Compliance Evidence**: Hash-chained audit logs and CSV exports support compliance evidence workflows but do not by themselves certify SOC 2, ISO 27001, or SOX compliance.
5. **Backups & External Monitoring**: Off-host database backups and Prometheus/Grafana scraping must be configured at the host/infrastructure layer before production use.

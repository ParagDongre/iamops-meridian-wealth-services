# Testing
`pytest -q tests` → 48 passed, 2 skipped (build environment, SQLite, fake connector). Skipped = live Keycloak/LDAP tests (`RUN_INTEGRATION=1`, services up), NOT run. Covers identity CRUD, JML, approvals, rejection, duplicates, RBAC, SoD, provisioning success/failure/retry/idempotency/escalation, ticket SLA, certification, audit immutability/export, metrics traceability. Not tested: Streamlit UI (compile-checked only), PostgreSQL trigger, live Keycloak/LDAP.

Streamlit single-process mode: verified with Streamlit's AppTest (login + all 11 pages render without exceptions), not in a real browser or on Streamlit Cloud.

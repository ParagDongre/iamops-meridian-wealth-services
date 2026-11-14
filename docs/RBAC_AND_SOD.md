# RBAC and SoD
Platform roles (admin/analyst/approver/viewer) are enforced in FastAPI dependencies (`require`), not only the UI; denials are audited. Business roles map to entitlements (`role_entitlements`).
Seeded SoD policies: Trade initiate/approve, Journal create/approve, Payroll edit/approve, Case manager/Compliance admin. Checked at request submission, before provisioning, and in the single grant function `rbac.grant`. Existing violations: `GET /rbac/sod/report`.
Limit: no automatic detection of unused access.

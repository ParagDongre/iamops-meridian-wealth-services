# IAMOps Architecture
```
Streamlit UI ──HTTP/JWT──> FastAPI routers ──> services (identity, rbac, requests, jml, provisioning,
                                               tickets, certification, audit, metrics)
                                   │                      │
                              PostgreSQL            connectors ──> Keycloak Admin REST
                           (source of truth)                  └─> OpenLDAP (ldap3)
```
Flow: request → approvals → SoD recheck → work item → connectors → local assignment → Fulfilled/Failed (+incident) → audit event at each step. Dashboard KPIs are computed from tables per request (`services/metrics.py`).

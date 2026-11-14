from fastapi import APIRouter, Depends
from ..config import get_settings
from ..deps import get_db, require
from ..services import metrics

r = APIRouter(prefix="/reports", tags=["reports"])
@r.get("/metrics")
def m(db=Depends(get_db), u=Depends(require("admin", "analyst", "approver"))): return metrics.compute(db)
@r.get("/system")
def system(db=Depends(get_db), u=Depends(require("admin"))):
    s = get_settings()
    return {"db_dialect": db.bind.dialect.name, "connectors": s.CONNECTORS, "keycloak_url": s.KEYCLOAK_URL,
            "ldap_url": s.LDAP_URL, "mode": "local-only (no external systems)" if s.CONNECTORS == "none" else "live connectors"}

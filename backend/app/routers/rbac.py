from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from ..deps import get_db, require
from ..models import Identity, Role, Application, Entitlement, SoDPolicy
from ..schemas import GrantIn
from ..services import rbac

r = APIRouter(prefix="/rbac", tags=["rbac"])
ANY = require("admin", "analyst", "approver", "viewer")

@r.get("/roles")
def roles(db=Depends(get_db), u=Depends(ANY)):
    return [{"id": x.id, "name": x.name,
             "entitlements": [e.name for e in rbac.role_entitlements(db, x.id)]}
            for x in db.scalars(select(Role))]

@r.get("/applications")
def apps(db=Depends(get_db), u=Depends(ANY)):
    return [{"id": a.id, "name": a.name, "sensitive": a.sensitive, "sla_hours": a.sla_hours,
             "entitlements": [{"id": e.id, "name": e.name, "sensitive": e.sensitive}
                              for e in db.scalars(select(Entitlement).where(Entitlement.application_id == a.id))]}
            for a in db.scalars(select(Application))]

@r.get("/sod/policies")
def policies(db=Depends(get_db), u=Depends(ANY)):
    return [{"id": p.id, "name": p.name, "a": p.entitlement_a_id, "b": p.entitlement_b_id,
             "description": p.description} for p in db.scalars(select(SoDPolicy))]

@r.get("/sod/check")
def check(identity_id: int, entitlement_id: int, db=Depends(get_db), u=Depends(ANY)):
    return {"violations": [p.name for p in rbac.sod_conflicts(db, identity_id, entitlement_id)]}

@r.get("/sod/report")
def report(db=Depends(get_db), u=Depends(require("admin", "analyst"))):
    return rbac.sod_report(db)

@r.post("/grant")  # direct admin grant; normal path is access request (Checkpoint 4)
def grant(b: GrantIn, db=Depends(get_db), u=Depends(require("admin"))):
    i = db.get(Identity, b.identity_id)
    if not i or not db.get(Entitlement, b.entitlement_id): raise HTTPException(404, "Not found")
    try: a = rbac.grant(db, u.employee_id, i, b.entitlement_id, source="admin")
    except PermissionError as e: raise HTTPException(403, str(e))
    return {"assignment_id": a.id, "status": a.status}

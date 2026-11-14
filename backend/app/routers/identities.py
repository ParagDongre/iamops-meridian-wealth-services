from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from ..deps import get_db, require
from ..models import Identity, Assignment, Entitlement, AccessRequest
from ..schemas import IdentityIn, IdentityPatch
from ..services import identity as svc

r = APIRouter(prefix="/identities", tags=["identities"])
ADM = require("admin", "analyst")
ANY = require("admin", "analyst", "approver", "viewer")

def _get(db, id):
    i = db.get(Identity, id)
    if not i: raise HTTPException(404, "Identity not found")
    return i
def _out(i): return svc.snap(i) | {"id": i.id}

@r.post("", status_code=201)
def create(b: IdentityIn, db=Depends(get_db), u=Depends(ADM)):
    try: return _out(svc.create(db, u.employee_id, b.model_dump()))
    except ValueError as e: raise HTTPException(409, str(e))

@r.get("")
def search(q: str | None = None, department: str | None = None, status: str | None = None,
           db=Depends(get_db), u=Depends(ANY)):
    return [_out(i) for i in svc.search(db, q, department, status)]

@r.get("/{id}")
def get(id: int, db=Depends(get_db), u=Depends(ANY)): return _out(_get(db, id))

@r.patch("/{id}")
def patch(id: int, b: IdentityPatch, db=Depends(get_db), u=Depends(ADM)):
    return _out(svc.update(db, u.employee_id, _get(db, id), b.model_dump(exclude_unset=True)))

@r.post("/{id}/activate")
def activate(id: int, db=Depends(get_db), u=Depends(require("admin"))):
    try: return _out(svc.set_active(db, u.employee_id, _get(db, id), True))
    except ValueError as e: raise HTTPException(409, str(e))

@r.post("/{id}/deactivate")
def deactivate(id: int, db=Depends(get_db), u=Depends(require("admin"))):
    return _out(svc.set_active(db, u.employee_id, _get(db, id), False))

@r.get("/{id}/history")
def history(id: int, db=Depends(get_db), u=Depends(ADM)):
    return [{"id": e.id, "actor": e.actor, "action": e.action, "timestamp": e.timestamp,
             "previous": e.previous_state, "new": e.new_state, "outcome": e.outcome}
            for e in svc.history(db, id)]

@r.get("/{id}/access")
def access(id: int, db=Depends(get_db), u=Depends(ANY)):
    rows = db.execute(select(Assignment, Entitlement).join(Entitlement,
        Entitlement.id == Assignment.entitlement_id).where(Assignment.identity_id == id)).all()
    return [{"assignment_id": a.id, "entitlement": e.name, "application_id": e.application_id,
             "status": a.status, "source": a.source} for a, e in rows]

@r.get("/{id}/requests")
def pending(id: int, db=Depends(get_db), u=Depends(ANY)):
    rs = db.scalars(select(AccessRequest).where(AccessRequest.target_id == id,
        AccessRequest.status.in_(["Submitted", "Pending Approval", "Approved", "Provisioning"])))
    return [{"id": x.id, "entitlement_id": x.entitlement_id, "status": x.status} for x in rs]

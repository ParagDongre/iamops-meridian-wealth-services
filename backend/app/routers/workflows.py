from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from pydantic import BaseModel, Field
from ..deps import get_db, require, current_user
from ..models import Identity, AccessRequest, Approval
from ..schemas import IdentityIn, IdentityPatch
from ..services import jml, requests as rq

r = APIRouter(tags=["workflows"])
OPS = require("admin", "analyst")

class ReqIn(BaseModel):
    target_id: int
    entitlement_id: int
    justification: str = Field(min_length=5)
    priority: str = Field(default="Medium", pattern="^(Low|Medium|High|Critical)$")
    action: str = Field(default="grant", pattern="^(grant|revoke)$")
class Decision(BaseModel):
    decision: str = Field(pattern="^(Approved|Rejected)$")
    comment: str | None = None

def _get(db, model, id):
    x = db.get(model, id)
    if not x: raise HTTPException(404, "Not found")
    return x
def _rq(x): return {c: getattr(x, c) for c in ("id","requestor_id","target_id","entitlement_id","action","priority",
                    "status","rejection_reason","created_at","sla_deadline","fulfilled_at","justification")}
def _wrap(fn):
    try: return fn()
    except LookupError as e: raise HTTPException(404, str(e))
    except PermissionError as e: raise HTTPException(403, str(e))
    except (ValueError, RuntimeError) as e: raise HTTPException(409, str(e))

@r.post("/jml/joiner", status_code=201)
def joiner(b: IdentityIn, db=Depends(get_db), u=Depends(OPS)):
    i, reqs, skipped = _wrap(lambda: jml.joiner(db, u, b.model_dump()))
    return {"identity_id": i.id, "requests": [_rq(x) for x in reqs], "skipped": skipped}

@r.post("/jml/mover/{id}")
def mover(id: int, b: IdentityPatch, db=Depends(get_db), u=Depends(OPS)):
    i, reqs, skipped, review = _wrap(lambda: jml.mover(db, u, _get(db, Identity, id), b.model_dump(exclude_unset=True)))
    return {"requests": [_rq(x) for x in reqs], "skipped": skipped, "review_required": review}

@r.post("/jml/leaver/{id}")
def leaver(id: int, db=Depends(get_db), u=Depends(require("admin"))):
    i, revoked, accts, wi = _wrap(lambda: jml.leaver(db, u, _get(db, Identity, id)))
    return {"status": i.employment_status, "revoked_entitlements": revoked, "accounts_disabled": len(accts) if wi.status == "Success" else 0,
            "external_disable_status": wi.status, "work_item_id": wi.id, "error": wi.error}

@r.post("/requests", status_code=201)
def submit(b: ReqIn, db=Depends(get_db), u: Identity = Depends(current_user)):
    t = _get(db, Identity, b.target_id)
    if not (u.id == t.id or u.app_role in ("admin", "analyst") or t.manager_id == u.id):
        raise HTTPException(403, "Not allowed to request access for this user")
    return _rq(_wrap(lambda: rq.submit(db, u, t, b.entitlement_id, b.justification, b.priority, b.action)))

@r.get("/requests")
def list_(status: str | None = None, db=Depends(get_db), u=Depends(OPS)):
    s = select(AccessRequest).order_by(AccessRequest.id.desc())
    if status: s = s.where(AccessRequest.status == status)
    return [_rq(x) for x in db.scalars(s)]

@r.get("/requests/my-approvals")
def mine(db=Depends(get_db), u: Identity = Depends(current_user)):
    ids = db.scalars(select(Approval.request_id).where(Approval.approver_id == u.id, Approval.decision == "Pending"))
    return [_rq(_get(db, AccessRequest, x)) for x in ids]

@r.get("/requests/{id}")
def one(id: int, db=Depends(get_db), u: Identity = Depends(current_user)):
    x = _get(db, AccessRequest, id)
    if u.app_role not in ("admin", "analyst") and u.id not in (x.target_id, x.requestor_id):
        raise HTTPException(403, "Forbidden")
    ap = db.scalars(select(Approval).where(Approval.request_id == id)).all()
    return _rq(x) | {"approvals": [{"stage": a.stage, "approver_id": a.approver_id, "decision": a.decision,
                                    "comment": a.comment, "decided_at": a.decided_at} for a in ap]}

@r.post("/requests/{id}/decision")
def decide(id: int, b: Decision, db=Depends(get_db), u: Identity = Depends(current_user)):
    return _rq(_wrap(lambda: rq.decide(db, u, _get(db, AccessRequest, id), b.decision, b.comment)))

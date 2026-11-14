from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from ..deps import get_db, require, current_user
from ..models import Campaign, CertItem
from ..services import certification as svc

r = APIRouter(prefix="/certification", tags=["certification"])
OPS = require("admin", "analyst")
class CampIn(BaseModel):
    name: str
    due_date: date
    department: str | None = None
class DecIn(BaseModel):
    decision: str
    justification: str | None = None

def _i(x): return {c: getattr(x, c) for c in ("id","campaign_id","assignment_id","reviewer_id","decision","justification","decided_at")}

@r.post("/campaigns", status_code=201)
def create(b: CampIn, db=Depends(get_db), u=Depends(require("admin"))):
    c, n = svc.create_campaign(db, u.employee_id, b.name, b.due_date, b.department)
    return {"campaign_id": c.id, "items": n}

@r.get("/campaigns")
def campaigns(db=Depends(get_db), u=Depends(OPS)): return [svc.stats(db, c.id) for c in db.scalars(select(Campaign))]

@r.get("/campaigns/{id}/items")
def items(id: int, db=Depends(get_db), u=Depends(OPS)):
    return [_i(x) for x in db.scalars(select(CertItem).where(CertItem.campaign_id == id))]

@r.get("/my-reviews")
def mine(db=Depends(get_db), u=Depends(current_user)):
    return [_i(x) for x in db.scalars(select(CertItem).where(CertItem.reviewer_id == u.id, CertItem.decision.in_(["Pending", "Investigate"])))]

@r.post("/items/{id}/decision")
def decide(id: int, b: DecIn, db=Depends(get_db), u=Depends(current_user)):
    it = db.get(CertItem, id)
    if not it: raise HTTPException(404, "Item not found")
    try: item, follow = svc.decide(db, u, it, b.decision, b.justification)
    except PermissionError as e: raise HTTPException(403, str(e))
    except ValueError as e: raise HTTPException(409, str(e))
    return _i(item) | {"revocation_request_status": follow}

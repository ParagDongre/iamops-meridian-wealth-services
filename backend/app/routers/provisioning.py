from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from ..deps import get_db, require
from ..models import WorkItem
from ..services import provisioning as pv

r = APIRouter(prefix="/provisioning", tags=["provisioning"])
OPS = require("admin", "analyst")
class Notes(BaseModel):
    notes: str = Field(min_length=3)

def _o(w): return {c: getattr(w, c) for c in ("id","identity_id","application_id","request_id","action","priority",
        "status","created_at","sla_deadline","retry_count","error","resolution_notes","ticket_id")}
def _get(db, id):
    w = db.get(WorkItem, id)
    if not w: raise HTTPException(404, "Work item not found")
    return w

@r.get("/work-items")
def list_(status: str | None = None, db=Depends(get_db), u=Depends(OPS)):
    s = select(WorkItem).order_by(WorkItem.id.desc())
    if status: s = s.where(WorkItem.status == status)
    return [_o(w) for w in db.scalars(s)]

@r.post("/work-items/{id}/retry")
def retry(id: int, db=Depends(get_db), u=Depends(OPS)):
    try: return _o(pv.retry(db, u.employee_id, _get(db, id)))
    except ValueError as e: raise HTTPException(409, str(e))

@r.post("/work-items/{id}/escalate")
def escalate(id: int, b: Notes, db=Depends(get_db), u=Depends(OPS)):
    return _o(pv.escalate(db, u.employee_id, _get(db, id), b.notes))

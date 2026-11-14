from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from ..deps import get_db, require, current_user
from ..models import Ticket, TicketComment, TicketEscalation, Identity
from ..services import tickets as svc

r = APIRouter(prefix="/tickets", tags=["tickets"])
OPS = require("admin", "analyst")
class TicketIn(BaseModel):
    ticket_type: str = "Request"
    description: str = Field(min_length=5)
    category: str = "Access"
    priority: str = "Medium"
    assignee_id: int | None = None
class AssignIn(BaseModel): assignee_id: int
class StatusIn(BaseModel):
    status: str
    notes: str | None = None
class Body(BaseModel): body: str = Field(min_length=1)
class Reason(BaseModel): reason: str = Field(min_length=3)

def _get(db, id):
    t = db.get(Ticket, id)
    if not t: raise HTTPException(404, "Ticket not found")
    return t
def _o(t): return {c: getattr(t, c) for c in ("id","ticket_type","requestor_id","assignee_id","description","category",
    "priority","status","created_at","updated_at","sla_deadline","resolution_notes","escalation_level",
    "related_request_id","related_work_item_id")} | {"sla_breached": svc.is_breached(t)}
def _w(fn):
    try: return fn()
    except ValueError as e: raise HTTPException(409, str(e))

@r.post("", status_code=201)
def create(b: TicketIn, db=Depends(get_db), u: Identity = Depends(current_user)):
    if u.app_role not in ("admin", "analyst") and (b.ticket_type != "Request" or b.assignee_id):
        raise HTTPException(403, "Only operations staff may create this ticket type / assign")
    return _o(_w(lambda: svc.create(db, u.employee_id, b.ticket_type, b.description, b.category, b.priority,
                                    u.id, b.assignee_id)))

@r.get("")
def list_(status: str | None = None, priority: str | None = None, assignee_id: int | None = None,
          db=Depends(get_db), u=Depends(OPS)):
    s = select(Ticket).order_by(Ticket.id.desc())
    if status: s = s.where(Ticket.status == status)
    if priority: s = s.where(Ticket.priority == priority)
    if assignee_id: s = s.where(Ticket.assignee_id == assignee_id)
    return [_o(t) for t in db.scalars(s)]

@r.get("/{id}")
def one(id: int, db=Depends(get_db), u: Identity = Depends(current_user)):
    t = _get(db, id)
    if u.app_role not in ("admin", "analyst") and u.id != t.requestor_id: raise HTTPException(403, "Forbidden")
    cs = db.scalars(select(TicketComment).where(TicketComment.ticket_id == id).order_by(TicketComment.id))
    es = db.scalars(select(TicketEscalation).where(TicketEscalation.ticket_id == id))
    return _o(t) | {"comments": [{"author_id": c.author_id, "body": c.body, "created_at": c.created_at} for c in cs],
                    "escalations": [{"from": e.from_level, "to": e.to_level, "reason": e.reason, "at": e.created_at} for e in es]}

@r.post("/{id}/assign")
def assign(id: int, b: AssignIn, db=Depends(get_db), u=Depends(OPS)):
    if not db.get(Identity, b.assignee_id): raise HTTPException(404, "Assignee not found")
    return _o(_w(lambda: svc.assign(db, u.employee_id, _get(db, id), b.assignee_id)))

@r.post("/{id}/status")
def status(id: int, b: StatusIn, db=Depends(get_db), u=Depends(OPS)):
    return _o(_w(lambda: svc.set_status(db, u.employee_id, _get(db, id), b.status, b.notes)))

@r.post("/{id}/comments", status_code=201)
def comment(id: int, b: Body, db=Depends(get_db), u=Depends(OPS)):
    svc.comment(db, u.id, _get(db, id), b.body); return {"ok": True}

@r.post("/{id}/escalate")
def escalate(id: int, b: Reason, db=Depends(get_db), u=Depends(OPS)):
    return _o(svc.escalate(db, u.employee_id, _get(db, id), b.reason))

@r.post("/sla-sweep")
def sweep(db=Depends(get_db), u=Depends(OPS)): return svc.sla_sweep(db, u.employee_id)

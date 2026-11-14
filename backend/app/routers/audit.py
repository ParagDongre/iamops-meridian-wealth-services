import csv, io
from datetime import datetime
from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy import select
from ..deps import get_db, require
from ..models import AuditEvent, WorkItem
from ..services import audit as svc, rbac, certification as cert
from ..models import Campaign

r = APIRouter(prefix="/audit", tags=["audit"])
OPS = require("admin", "analyst")
COLS = ["id","timestamp","actor","target_identity_id","action","outcome","related_request_id","related_ticket_id","previous_state","new_state"]

def _q(actor, action, target_id, outcome, since, until):
    s = select(AuditEvent).order_by(AuditEvent.id.desc())
    for col, v in ((AuditEvent.actor, actor), (AuditEvent.action, action), (AuditEvent.target_identity_id, target_id), (AuditEvent.outcome, outcome)):
        if v is not None: s = s.where(col == v)
    if since: s = s.where(AuditEvent.timestamp >= since)
    if until: s = s.where(AuditEvent.timestamp <= until)
    return s
def _row(e): return {c: getattr(e, c) for c in COLS}

@r.get("/events")
def events(actor: str | None = None, action: str | None = None, target_id: int | None = None, outcome: str | None = None,
           since: datetime | None = None, until: datetime | None = None, limit: int = 200, db=Depends(get_db), u=Depends(OPS)):
    return [_row(e) for e in db.scalars(_q(actor, action, target_id, outcome, since, until).limit(min(limit, 1000)))]

def _safe(v):  # neutralise spreadsheet formula injection in exported evidence
    s = "" if v is None else str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@") else s

@r.get("/export.csv")
def export(actor: str | None = None, action: str | None = None, target_id: int | None = None, outcome: str | None = None,
           since: datetime | None = None, until: datetime | None = None, db=Depends(get_db), u=Depends(require("admin"))):
    rows = db.scalars(_q(actor, action, target_id, outcome, since, until)).all()
    buf = io.StringIO(); w = csv.writer(buf); w.writerow(COLS)
    for e in rows: w.writerow([_safe(_row(e)[c]) for c in COLS])
    svc.log(db, u.employee_id, "audit_exported", new={"rows": len(rows)}); db.commit()
    return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=audit_evidence.csv"})

@r.get("/reports/failed-provisioning")
def failed(db=Depends(get_db), u=Depends(OPS)):
    return [{"work_item": w.id, "identity_id": w.identity_id, "action": w.action, "status": w.status,
             "retries": w.retry_count, "error": w.error, "ticket_id": w.ticket_id}
            for w in db.scalars(select(WorkItem).where(WorkItem.status.in_(["Failed", "Escalated"])))]

@r.get("/reports/sod-violations")
def sod(db=Depends(get_db), u=Depends(OPS)):
    blocked = db.scalars(select(AuditEvent).where(AuditEvent.action.in_(["sod_violation_blocked", "request_blocked_sod"]))).all()
    return {"active_violations": rbac.sod_report(db),
            "blocked_attempts": [{"event": e.id, "identity_id": e.target_identity_id, "detail": e.new_state, "at": e.timestamp} for e in blocked]}

@r.get("/reports/access-review")
def review(db=Depends(get_db), u=Depends(OPS)): return [cert.stats(db, c.id) for c in db.scalars(select(Campaign))]

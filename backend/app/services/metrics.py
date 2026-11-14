"""Every figure is computed from stored rows at request time. Nothing is hardcoded."""
from collections import Counter, defaultdict
from datetime import datetime
from sqlalchemy import select
from ..models import (Identity, AccessRequest, WorkItem, Ticket, CertItem, Entitlement, Application)
from . import rbac

OPEN_REQ = ("Submitted", "Pending Approval", "Approved", "Provisioning")
def _pct(a, b): return round(100 * a / b, 1) if b else 100.0

def compute(db, now=None):
    now = now or datetime.utcnow()
    reqs = db.scalars(select(AccessRequest)).all(); wis = db.scalars(select(WorkItem)).all()
    tks = db.scalars(select(Ticket)).all(); items = db.scalars(select(CertItem)).all()
    app_of = {e.id: db.get(Application, e.application_id).name for e in db.scalars(select(Entitlement))}
    def late(r): return (r.status == "Fulfilled" and r.fulfilled_at > r.sla_deadline) or (r.status in OPEN_REQ and now > r.sla_deadline)
    met = [r for r in reqs if r.status == "Fulfilled" and r.fulfilled_at <= r.sla_deadline]
    breached = [r for r in reqs if late(r)]
    done = [r for r in reqs if r.status == "Fulfilled"]
    reviewed = sum(i.decision != "Pending" for i in items)
    kpis = {
      "active_identities": db.scalar(select(__import__("sqlalchemy").func.count()).select_from(Identity).where(Identity.lifecycle_status == "Active")),
      "pending_requests": sum(r.status in ("Submitted", "Pending Approval") for r in reqs),
      "awaiting_approval": sum(r.status == "Pending Approval" for r in reqs),
      "work_items": len(wis), "provisioning_success": sum(w.status == "Success" for w in wis),
      "provisioning_failed": sum(w.status in ("Failed", "Escalated") for w in wis),
      "open_tickets": sum(t.status not in ("Resolved", "Closed") for t in tks),
      "sla_compliance_pct": _pct(len(met), len(met) + len(breached)),
      "avg_fulfilment_hours": round(sum((r.fulfilled_at - r.created_at).total_seconds() for r in done) / len(done) / 3600, 2) if done else 0,
      "overdue_requests": sum(r.status in OPEN_REQ and now > r.sla_deadline for r in reqs),
      "access_review_completion_pct": _pct(reviewed, len(items)),
      "sod_violations": len(rbac.sod_report(db)),
    }
    by_day = Counter(r.created_at.date().isoformat() for r in reqs)
    prov = defaultdict(lambda: {"Success": 0, "Failed": 0})
    for w in wis: prov[w.created_at.date().isoformat()]["Success" if w.status == "Success" else "Failed"] += 1 if w.status in ("Success", "Failed", "Escalated") else 0
    sla = defaultdict(lambda: [0, 0])
    for r in met: sla[app_of[r.entitlement_id]][0] += 1
    for r in breached: sla[app_of[r.entitlement_id]][1] += 1
    age = Counter()
    for w in wis:
        if w.status in ("Queued", "Failed", "Escalated"):
            h = (now - w.created_at).total_seconds() / 3600
            age["<4h" if h < 4 else "4-24h" if h < 24 else "1-3d" if h < 72 else ">3d"] += 1
    names = {i.id: i.full_name for i in db.scalars(select(Identity))}
    load = Counter(names.get(t.assignee_id, "Unassigned") for t in tks if t.status not in ("Resolved", "Closed"))
    return {"kpis": kpis,
      "sources": {"active_identities": "identities.lifecycle_status='Active'", "sla_compliance_pct": "access_requests fulfilled_at<=sla_deadline vs late/overdue",
                  "provisioning_failed": "work_items.status in (Failed,Escalated)", "sod_violations": "assignments x sod_policies (live scan)"},
      "request_volume_by_day": dict(sorted(by_day.items())), "provisioning_by_day": dict(sorted(prov.items())),
      "ticket_priority": dict(Counter(t.priority for t in tks)),
      "sla_by_application": {a: _pct(m, m + b) for a, (m, b) in sla.items()},
      "workitem_ageing": dict(age), "analyst_workload": dict(load)}

from datetime import date, datetime
from sqlalchemy import select
from ..models import Campaign, CertItem, Assignment, Identity, Entitlement, Application
from . import audit, requests as rq, tickets

DECISIONS = ("Certified", "Revoked", "Investigate", "Inappropriate")

def _reviewer(db, target, ent):
    app = db.get(Application, ent.application_id)
    for rid in (target.manager_id, app.owner_id):
        if rid and rid != target.id: return rid
    return db.scalar(select(Identity.id).where(Identity.app_role == "admin", Identity.id != target.id))

def create_campaign(db, actor, name, due: date, department=None):
    c = Campaign(name=name, due_date=due); db.add(c); db.flush(); n = 0
    for a in db.scalars(select(Assignment).where(Assignment.status == "Active")):
        t = db.get(Identity, a.identity_id)
        if t.lifecycle_status != "Active" or (department and t.department != department): continue
        if (rid := _reviewer(db, t, db.get(Entitlement, a.entitlement_id))):
            db.add(CertItem(campaign_id=c.id, assignment_id=a.id, reviewer_id=rid)); n += 1
    audit.log(db, actor, "campaign_created", new={"campaign": c.id, "items": n, "due": str(due)}); db.commit(); return c, n

def decide(db, reviewer, item, decision, justification=None):
    if decision not in DECISIONS: raise ValueError("Invalid decision")
    if item.reviewer_id != reviewer.id: raise PermissionError("Not the assigned reviewer")
    if item.decision not in ("Pending", "Investigate"): raise ValueError("Item already decided")
    if decision != "Certified" and not justification: raise ValueError("Justification required")
    a = db.get(Assignment, item.assignment_id); t = db.get(Identity, a.identity_id)
    if t.id == reviewer.id: raise PermissionError("Self-review is not allowed")
    prev = item.decision
    item.decision, item.justification, item.decided_at = decision, justification, datetime.utcnow()
    audit.log(db, reviewer.employee_id, f"certification_{decision.lower()}", t.id,
              prev={"decision": prev}, new={"item": item.id, "assignment": a.id, "justification": justification})
    db.commit(); follow = None
    if decision in ("Revoked", "Inappropriate") and a.status == "Active":
        follow = rq.submit(db, reviewer, t, a.entitlement_id, f"Certification: {justification}", "High", "revoke").status
    if decision == "Inappropriate":
        tickets.create(db, reviewer.employee_id, "Incident", f"Inappropriate access flagged for identity {t.employee_id}: {justification}",
                       "Access Governance", "High", t.id, auto_assign=True)
    if decision == "Investigate":
        tickets.create(db, reviewer.employee_id, "Task", f"Investigate access of {t.employee_id}: {justification}",
                       "Access Governance", "Medium", t.id, auto_assign=True)
    return item, follow

def stats(db, campaign_id, today=None):
    today = today or date.today(); c = db.get(Campaign, campaign_id)
    items = db.scalars(select(CertItem).where(CertItem.campaign_id == campaign_id)).all()
    cnt = lambda d: sum(i.decision == d for i in items)
    pending = cnt("Pending") + cnt("Investigate")
    return {"campaign_id": c.id, "name": c.name, "due_date": str(c.due_date), "total": len(items),
            "reviewed": len(items) - cnt("Pending"), "certified": cnt("Certified"), "revoked": cnt("Revoked"),
            "investigate": cnt("Investigate"), "inappropriate": cnt("Inappropriate"), "pending": pending,
            "overdue": pending if c.due_date < today else 0}

"""Custom ITSM simulation (NOT ServiceNow). SLA deadlines are stored at creation; breach = now > deadline."""
from datetime import datetime, timedelta
from sqlalchemy import select, func
from ..models import Ticket, TicketComment, TicketEscalation, Identity, WorkItem
from . import audit

SLA_HOURS = {"Critical": 4, "High": 8, "Medium": 24, "Low": 72}
TYPES = ("Incident", "Request", "Task")
FLOW = {"New": ["Assigned", "In Progress", "Resolved"], "Assigned": ["In Progress", "Resolved"],
        "In Progress": ["Resolved", "Assigned"], "Resolved": ["Closed", "In Progress"], "Closed": []}
DONE = ("Resolved", "Closed")
def _now(): return datetime.utcnow()

def least_loaded_analyst(db):
    ops = db.scalars(select(Identity).where(Identity.app_role.in_(["admin", "analyst"]),
                                            Identity.lifecycle_status == "Active")).all()
    def load(i): return db.scalar(select(func.count()).select_from(Ticket).where(Ticket.assignee_id == i.id, Ticket.status.not_in(DONE)))
    return min(ops, key=load, default=None)

def create(db, actor, ttype, description, category="Access", priority="Medium", requestor_id=None,
           assignee_id=None, request_id=None, work_item_id=None, auto_assign=False):
    if ttype not in TYPES: raise ValueError("Invalid ticket type")
    if priority not in SLA_HOURS: raise ValueError("Invalid priority")
    if auto_assign and not assignee_id and (a := least_loaded_analyst(db)): assignee_id = a.id
    t = Ticket(ticket_type=ttype, requestor_id=requestor_id, assignee_id=assignee_id, description=description,
               category=category, priority=priority, status="Assigned" if assignee_id else "New",
               sla_deadline=_now() + timedelta(hours=SLA_HOURS[priority]),
               related_request_id=request_id, related_work_item_id=work_item_id)
    db.add(t); db.flush()
    audit.log(db, actor, "ticket_created", requestor_id, request_id=request_id, ticket_id=t.id,
              new={"type": ttype, "priority": priority, "assignee": assignee_id}); db.commit(); return t

def assign(db, actor, t, assignee_id):
    if t.status == "Closed": raise ValueError("Ticket is closed")
    prev = t.assignee_id; t.assignee_id = assignee_id
    if t.status == "New": t.status = "Assigned"
    audit.log(db, actor, "ticket_assigned", ticket_id=t.id, prev={"assignee": prev}, new={"assignee": assignee_id})
    db.commit(); return t

def set_status(db, actor, t, status, notes=None):
    if status not in FLOW.get(t.status, []): raise ValueError(f"Cannot move {t.status} -> {status}")
    if status == "Resolved":
        if not notes: raise ValueError("Resolution notes required")
        t.resolution_notes = notes
    prev = t.status; t.status = status
    audit.log(db, actor, f"ticket_{status.lower().replace(' ', '_')}", ticket_id=t.id, prev={"status": prev}, new={"status": status})
    db.commit(); return t

def comment(db, author_id, t, body):
    c = TicketComment(ticket_id=t.id, author_id=author_id, body=body); db.add(c); t.updated_at = _now(); db.commit(); return c

def escalate(db, actor, t, reason):
    if t.escalation_level >= 2: return t  # idempotent: already at L2
    db.add(TicketEscalation(ticket_id=t.id, from_level=t.escalation_level, to_level=2, reason=reason))
    t.escalation_level = 2
    if t.priority in ("Low", "Medium"): t.priority = "High"
    audit.log(db, actor, "ticket_escalated", ticket_id=t.id, new={"level": 2, "reason": reason}); db.commit(); return t

def is_breached(t, now=None): return t.status not in DONE and (now or _now()) > t.sla_deadline

def sla_sweep(db, actor="system", now=None):
    """Escalate breached tickets once and flag overdue work items. Run on a schedule or via API."""
    now = now or _now(); esc = []
    for t in db.scalars(select(Ticket).where(Ticket.status.not_in(DONE))):
        if is_breached(t, now) and t.escalation_level < 2:
            escalate(db, actor, t, "SLA breached"); esc.append(t.id)
    overdue = db.scalars(select(WorkItem.id).where(WorkItem.status.in_(["Queued", "Failed"]), WorkItem.sla_deadline < now)).all()
    return {"escalated_tickets": esc, "overdue_work_items": list(overdue)}

def provisioning_failure_ticket(db, wi, error):
    """One incident per failing work item; later failures add a comment instead of a duplicate ticket."""
    if wi.ticket_id:
        comment(db, None, db.get(Ticket, wi.ticket_id), f"Retry {wi.retry_count} failed: {error}"); return db.get(Ticket, wi.ticket_id)
    t = create(db, "system", "Incident", f"Provisioning failed for work item {wi.id} ({wi.action}): {error}",
               "Provisioning", wi.priority if wi.priority in SLA_HOURS else "Medium", wi.identity_id,
               request_id=wi.request_id, work_item_id=wi.id, auto_assign=True)
    wi.ticket_id = t.id; db.commit(); return t

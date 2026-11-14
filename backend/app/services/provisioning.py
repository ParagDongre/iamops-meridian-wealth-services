"""Provisioning orchestration. Order: precheck -> external systems -> local state. Never reports
success unless every connector succeeded. Retries are safe: connector calls are idempotent."""
from datetime import datetime, timedelta
from sqlalchemy import select
from ..connectors import registry
from ..models import WorkItem, Account, Identity, AccessRequest, Entitlement, Application
from . import audit, rbac, tickets

MAX_RETRIES = 3
def _now(): return datetime.utcnow()

def enqueue_for_request(db, r):
    key = f"req-{r.id}-{r.action}"
    if (wi := db.scalar(select(WorkItem).where(WorkItem.idempotency_key == key))): return wi  # duplicate action
    app_id = db.get(Entitlement, r.entitlement_id).application_id
    wi = WorkItem(identity_id=r.target_id, application_id=app_id, request_id=r.id, action=r.action,
                  priority=r.priority, sla_deadline=r.sla_deadline, idempotency_key=key)
    db.add(wi); db.commit(); return wi

def enqueue_disable(db, identity_id, tag):
    key = f"disable-{identity_id}-{tag}"
    if (wi := db.scalar(select(WorkItem).where(WorkItem.idempotency_key == key))): return wi
    wi = WorkItem(identity_id=identity_id, action="disable_account", priority="High", idempotency_key=key,
                  sla_deadline=_now() + timedelta(hours=4))
    db.add(wi); db.commit(); return wi

def _upsert_account(db, i, system, ext, status="Active"):
    a = db.scalar(select(Account).where(Account.identity_id == i.id, Account.system == system))
    if a: a.external_id, a.status = ext or a.external_id, status
    else: db.add(Account(identity_id=i.id, system=system, username=i.email.split("@")[0], external_id=ext, status=status))

def _each(conns, errors, fn):
    for c in conns:
        try: fn(c)
        except Exception as e: errors.append(f"{c.name}: {e}")  # partial failures are collected, not hidden

def run(db, wi: WorkItem) -> WorkItem:
    if wi.status == "Success": return wi  # idempotent
    i = db.get(Identity, wi.identity_id)
    r = db.get(AccessRequest, wi.request_id) if wi.request_id else None
    conns, errors = registry.get(), []
    try:
        if wi.action == "grant":
            if i.lifecycle_status != "Active" or i.employment_status == "Terminated":
                raise PermissionError("Identity not active")
            if (bad := rbac.sod_conflicts(db, i.id, r.entitlement_id)):
                raise PermissionError("SoD violation: " + "; ".join(p.name for p in bad))
            ent = db.get(Entitlement, r.entitlement_id); g = f"{db.get(Application, ent.application_id).name}:{ent.name}"
            def f(c):
                _upsert_account(db, i, c.name, c.ensure_account(i)); c.add_to_group(i, g)
            _each(conns, errors, f)
            if not errors: rbac.grant(db, "system", i, r.entitlement_id, "request", r.id)
        elif wi.action == "revoke":
            ent = db.get(Entitlement, r.entitlement_id); g = f"{db.get(Application, ent.application_id).name}:{ent.name}"
            _each(conns, errors, lambda c: c.remove_from_group(i, g))
            if not errors: rbac.revoke(db, "system", i, r.entitlement_id, r.id)
        elif wi.action == "disable_account":
            _each(conns, errors, lambda c: c.disable_account(i))
            if not errors:
                for a in db.scalars(select(Account).where(Account.identity_id == i.id)): a.status = "Disabled"
        else: raise ValueError(f"Unknown action {wi.action}")
    except Exception as e:
        errors.append(str(e))
    if errors: return _fail(db, wi, r, errors)
    wi.status, wi.error = "Success", None
    if not conns: wi.resolution_notes = "No external connectors configured: local state only"
    if r: r.status, r.fulfilled_at = "Fulfilled", _now()
    audit.log(db, "system", f"provisioning_{wi.action}", wi.identity_id, request_id=r.id if r else None,
              new={"work_item": wi.id, "systems": [c.name for c in conns]})
    db.commit(); return wi

def _fail(db, wi, r, errors):
    wi.retry_count += 1; wi.error = " | ".join(errors)
    wi.status = "Escalated" if wi.retry_count >= MAX_RETRIES else "Failed"
    if r: r.status = "Failed"
    audit.log(db, "system", "provisioning_failed" if wi.status == "Failed" else "escalated_to_l2", wi.identity_id,
              request_id=r.id if r else None, outcome="Failed", new={"work_item": wi.id, "error": wi.error, "retry": wi.retry_count})
    db.commit(); tickets.provisioning_failure_ticket(db, wi, wi.error); return wi

def retry(db, actor, wi):
    if wi.status == "Success": return wi
    if wi.status not in ("Failed", "Escalated"): raise ValueError(f"Work item is {wi.status}")
    audit.log(db, actor, "provisioning_retry", wi.identity_id, new={"work_item": wi.id, "attempt": wi.retry_count + 1})
    if wi.request_id: db.get(AccessRequest, wi.request_id).status = "Provisioning"
    wi.status = "Queued"; db.commit(); return run(db, wi)

def escalate(db, actor, wi, notes):
    wi.status, wi.resolution_notes = "Escalated", notes
    audit.log(db, actor, "escalated_to_l2", wi.identity_id, new={"work_item": wi.id, "notes": notes}); db.commit(); return wi

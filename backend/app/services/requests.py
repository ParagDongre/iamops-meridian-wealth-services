from datetime import datetime, timedelta
from sqlalchemy import select
from ..models import AccessRequest, Approval, Application, Entitlement, Identity
from . import audit, rbac

OPEN = ["Submitted", "Pending Approval", "Approved", "Provisioning"]
def _now(): return datetime.utcnow()

def _compliance_approver(db):
    return db.scalar(select(Identity.id).where(Identity.department == "Compliance",
        Identity.app_role == "approver", Identity.lifecycle_status == "Active"))

def submit(db, actor, target, ent_id, justification, priority="Medium", action="grant"):
    ent = db.get(Entitlement, ent_id)
    if not ent: raise LookupError("Entitlement not found")
    if target.lifecycle_status != "Active" or target.employment_status == "Terminated":
        raise PermissionError("Target identity is not active")
    if db.scalar(select(AccessRequest.id).where(AccessRequest.target_id == target.id,
            AccessRequest.entitlement_id == ent_id, AccessRequest.action == action,
            AccessRequest.status.in_(OPEN))):
        raise ValueError("Duplicate open request")
    held = rbac.active_ent_ids(db, target.id)
    if action == "grant":
        if ent_id in held: raise ValueError("Access already held")
        bad = rbac.sod_conflicts(db, target.id, ent_id)
        if bad:
            audit.log(db, actor.employee_id, "request_blocked_sod", target.id, outcome="Denied",
                      new={"policies": [p.name for p in bad]}); db.commit()
            raise PermissionError("SoD violation: " + "; ".join(p.name for p in bad))
    elif ent_id not in held: raise ValueError("Access not currently held")
    app = db.get(Application, ent.application_id)
    if action == "grant" and not app.owner_id: raise ValueError("Application has no owner; assign one in the catalog")
    r = AccessRequest(requestor_id=actor.id, target_id=target.id, entitlement_id=ent_id, action=action,
                      justification=justification, priority=priority, status="Submitted",
                      sla_deadline=_now() + timedelta(hours=app.sla_hours))
    db.add(r); db.flush()
    stages = []
    if action == "grant":  # revocations need no approval
        if target.manager_id: stages.append(("manager", target.manager_id))
        if app.owner_id: stages.append(("app_owner", app.owner_id))
        if ent.sensitive and (c := _compliance_approver(db)): stages.append(("compliance", c))
    for st, aid in stages: db.add(Approval(request_id=r.id, stage=st, approver_id=aid))
    r.status = "Pending Approval" if stages else "Approved"
    audit.log(db, actor.employee_id, "access_requested", target.id, request_id=r.id,
              new={"entitlement_id": ent_id, "action": action, "stages": [s for s, _ in stages]})
    db.commit()
    if r.status == "Approved": fulfil(db, r)
    return r

def decide(db, approver, r, decision, comment=None):
    if r.status != "Pending Approval": raise ValueError(f"Request is {r.status}")
    if approver.id == r.target_id: raise PermissionError("Self-approval is not allowed")
    mine = db.scalars(select(Approval).where(Approval.request_id == r.id,
            Approval.approver_id == approver.id, Approval.decision == "Pending")).all()
    if not mine: raise PermissionError("Not an assigned approver for this request")
    if decision == "Rejected" and not comment: raise ValueError("Rejection reason required")
    for a in mine: a.decision, a.comment, a.decided_at = decision, comment, _now()
    audit.log(db, approver.employee_id, f"approval_{decision.lower()}", r.target_id, request_id=r.id,
              new={"stages": [a.stage for a in mine], "comment": comment})
    if decision == "Rejected":
        r.status, r.rejection_reason = "Rejected", comment
        for a in db.scalars(select(Approval).where(Approval.request_id == r.id, Approval.decision == "Pending")):
            a.decision = "Cancelled"
        db.commit(); return r
    db.flush()  # sessions use autoflush=False
    if not db.scalar(select(Approval.id).where(Approval.request_id == r.id, Approval.decision == "Pending")):
        r.status = "Approved"; db.commit(); fulfil(db, r)
    else: db.commit()
    return r

def cancel_open(db, actor, identity_id, reason):
    n = 0
    for r in db.scalars(select(AccessRequest).where(AccessRequest.target_id == identity_id,
                                                     AccessRequest.status.in_(OPEN))):
        r.status, r.rejection_reason = "Rejected", reason
        for a in db.scalars(select(Approval).where(Approval.request_id == r.id, Approval.decision == "Pending")):
            a.decision = "Cancelled"
        audit.log(db, actor, "request_cancelled", identity_id, request_id=r.id, new={"reason": reason}); n += 1
    db.commit(); return n

def fulfil(db, r):
    """Hand off to the provisioning engine (work item -> connectors -> local state)."""
    from . import provisioning
    r.status = "Provisioning"; db.commit()
    provisioning.run(db, provisioning.enqueue_for_request(db, r))

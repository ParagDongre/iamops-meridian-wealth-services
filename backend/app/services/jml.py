from sqlalchemy import select, delete
from ..models import Identity, Assignment, GroupMember, Account
from . import audit, rbac, provisioning, requests as rq
from . import identity as idsvc

def _try(db, actor, target, ent_id, why, action, out, skipped):
    try: out.append(rq.submit(db, actor, target, ent_id, why, "Medium", action))
    except (ValueError, PermissionError, LookupError) as e: skipped.append({"entitlement_id": ent_id, "reason": str(e)})

def joiner(db, actor, data):
    i = idsvc.create(db, actor.employee_id, data)
    reqs, skipped = [], []
    if i.business_role_id:
        for e in rbac.role_entitlements(db, i.business_role_id):
            _try(db, actor, i, e.id, "Joiner: birthright access for role", "grant", reqs, skipped)
    audit.log(db, actor.employee_id, "joiner_processed", i.id, new={"requests": [r.id for r in reqs], "skipped": skipped})
    db.commit(); return i, reqs, skipped

def mover(db, actor, i, changes):
    prev = idsvc.snap(i); old_role = i.business_role_id
    for k in ("department", "job_title", "manager_id", "business_role_id"):
        if k in changes and changes[k] is not None: setattr(i, k, changes[k])
    old = {e.id for e in rbac.role_entitlements(db, old_role)} if old_role else set()
    new = {e.id for e in rbac.role_entitlements(db, i.business_role_id)} if i.business_role_id else set()
    held = rbac.active_ent_ids(db, i.id)
    reqs, skipped = [], []
    removed = sorted((held & old) - new)  # removals first so they cannot cause SoD conflicts
    for e in removed: _try(db, actor, i, e, "Mover: access no longer required", "revoke", reqs, skipped)
    for e in sorted(new - held): _try(db, actor, i, e, "Mover: access for new role", "grant", reqs, skipped)
    review = sorted(rbac.active_ent_ids(db, i.id) - new)  # ad-hoc access kept but flagged
    audit.log(db, actor.employee_id, "mover_processed", i.id, prev=prev,
              new=idsvc.snap(i) | {"removed": removed, "requests": [r.id for r in reqs],
                                   "review_required": review, "skipped": skipped})
    db.commit(); return i, reqs, skipped, review

def leaver(db, actor, i):
    prev = idsvc.snap(i)
    i.employment_status, i.lifecycle_status = "Terminated", "Disabled"; i.token_version += 1
    cancelled = rq.cancel_open(db, actor.employee_id, i.id, "Target terminated")
    revoked = [a.entitlement_id for a in db.scalars(select(Assignment).where(
        Assignment.identity_id == i.id, Assignment.status == "Active"))]
    for e in revoked: rbac.revoke(db, actor.employee_id, i, e)
    db.execute(delete(GroupMember).where(GroupMember.identity_id == i.id))
    db.commit()
    accts = db.scalars(select(Account).where(Account.identity_id == i.id, Account.status == "Active")).all()
    wi = provisioning.run(db, provisioning.enqueue_disable(db, i.id, "leaver"))  # disables IdP/LDAP accounts
    if rbac.active_ent_ids(db, i.id):  # safeguard against privilege retention
        audit.log(db, actor.employee_id, "leaver_incomplete", i.id, outcome="Failed"); db.commit()
        raise RuntimeError("Leaver failed: residual access remains")
    audit.log(db, actor.employee_id, "leaver_processed", i.id, prev=prev, new=idsvc.snap(i) |
              {"revoked": revoked, "cancelled_requests": cancelled, "accounts": [a.system for a in accts], "disable_work_item": wi.id, "disable_status": wi.status})
    db.commit(); return i, revoked, accts, wi

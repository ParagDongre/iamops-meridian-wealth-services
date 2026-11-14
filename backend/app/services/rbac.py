from sqlalchemy import select
from ..models import (Assignment, SoDPolicy, Entitlement, Identity, RoleEntitlement)
from . import audit

def active_ent_ids(db, identity_id) -> set[int]:
    return set(db.scalars(select(Assignment.entitlement_id).where(
        Assignment.identity_id == identity_id, Assignment.status == "Active")))

def sod_conflicts(db, identity_id, new_ent_id) -> list[SoDPolicy]:
    """Policies that would be violated if identity were granted new_ent_id."""
    held = active_ent_ids(db, identity_id) | {new_ent_id}
    return [p for p in db.scalars(select(SoDPolicy))
            if p.entitlement_a_id in held and p.entitlement_b_id in held
            and new_ent_id in (p.entitlement_a_id, p.entitlement_b_id)]

def sod_report(db) -> list[dict]:
    """Existing violations across all active identities."""
    out = []
    for i in db.scalars(select(Identity).where(Identity.lifecycle_status == "Active")):
        held = active_ent_ids(db, i.id)
        for p in db.scalars(select(SoDPolicy)):
            if p.entitlement_a_id in held and p.entitlement_b_id in held:
                out.append({"identity_id": i.id, "employee_id": i.employee_id, "policy": p.name})
    return out

def role_entitlements(db, role_id) -> list[Entitlement]:
    return db.scalars(select(Entitlement).join(RoleEntitlement,
        RoleEntitlement.entitlement_id == Entitlement.id).where(RoleEntitlement.role_id == role_id)).all()

def grant(db, actor, identity: Identity, ent_id: int, source="request", request_id=None) -> Assignment:
    """Single choke point for granting. Enforces SoD and lifecycle in the backend."""
    if identity.lifecycle_status != "Active" or identity.employment_status == "Terminated":
        raise PermissionError("Cannot grant access to inactive/terminated identity")
    bad = sod_conflicts(db, identity.id, ent_id)
    if bad:
        audit.log(db, actor, "sod_violation_blocked", identity.id, request_id=request_id,
                  outcome="Denied", new={"policies": [p.name for p in bad], "entitlement_id": ent_id})
        db.commit()
        raise PermissionError("SoD violation: " + "; ".join(p.name for p in bad))
    a = db.scalar(select(Assignment).where(Assignment.identity_id == identity.id,
                                           Assignment.entitlement_id == ent_id))
    if a and a.status == "Active":
        return a  # idempotent
    if a:
        a.status, a.revoked_at, a.source = "Active", None, source
    else:
        a = Assignment(identity_id=identity.id, entitlement_id=ent_id, source=source); db.add(a)
    db.flush()
    audit.log(db, actor, "access_granted", identity.id, request_id=request_id,
              new={"entitlement_id": ent_id, "source": source})
    db.commit(); return a

def revoke(db, actor, identity: Identity, ent_id: int, request_id=None) -> bool:
    from datetime import datetime
    a = db.scalar(select(Assignment).where(Assignment.identity_id == identity.id,
        Assignment.entitlement_id == ent_id, Assignment.status == "Active"))
    if not a: return False
    a.status, a.revoked_at = "Revoked", datetime.utcnow()
    audit.log(db, actor, "access_revoked", identity.id, request_id=request_id,
              prev={"entitlement_id": ent_id, "status": "Active"}, new={"status": "Revoked"})
    db.commit(); return True

from datetime import date
from sqlalchemy import select, or_
from ..models import Identity, AuditEvent
from . import audit

FIELDS = ["employee_id","full_name","email","department","job_title","manager_id","employment_type",
          "location","joining_date","employment_status","lifecycle_status","business_role_id","app_role"]

def snap(i: Identity) -> dict:
    return {f: (str(getattr(i, f)) if isinstance(getattr(i, f), date) else getattr(i, f)) for f in FIELDS}

def create(db, actor, data: dict) -> Identity:
    if db.scalar(select(Identity).where(or_(Identity.employee_id == data["employee_id"],
                                            Identity.email == data["email"]))):
        raise ValueError("Employee ID or email already exists")
    i = Identity(**data); db.add(i); db.flush()
    audit.log(db, actor, "identity_created", i.id, new=snap(i))
    db.commit(); return i

def update(db, actor, i: Identity, changes: dict) -> Identity:
    prev = snap(i)
    for k, v in changes.items():
        if k in ("employee_id", "lifecycle_status", "employment_status"):
            continue  # lifecycle fields change only via activate/deactivate or Leaver workflow
        setattr(i, k, v)
    audit.log(db, actor, "identity_updated", i.id, prev=prev, new=snap(i))
    db.commit(); return i

def set_active(db, actor, i: Identity, active: bool) -> Identity:
    prev = snap(i)
    if active and i.employment_status == "Terminated":
        raise ValueError("Terminated identities cannot be reactivated")
    i.lifecycle_status = "Active" if active else "Disabled"
    if not active: i.token_version += 1  # revoke live sessions
    audit.log(db, actor, "identity_activated" if active else "identity_deactivated",
              i.id, prev=prev, new=snap(i))
    db.commit(); return i

def search(db, q=None, department=None, status=None, limit=200):
    s = select(Identity)
    if q: s = s.where(or_(Identity.full_name.ilike(f"%{q}%"), Identity.email.ilike(f"%{q}%"),
                          Identity.employee_id.ilike(f"%{q}%")))
    if department: s = s.where(Identity.department == department)
    if status: s = s.where(Identity.lifecycle_status == status)
    return db.scalars(s.order_by(Identity.id).limit(limit)).all()

def history(db, identity_id):
    return db.scalars(select(AuditEvent).where(AuditEvent.target_identity_id == identity_id)
                      .order_by(AuditEvent.id)).all()

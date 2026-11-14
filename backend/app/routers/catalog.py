"""Catalog administration (admin only). Design-time SoD: roles may not bundle conflicting entitlements."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, delete
from ..deps import get_db, require
from ..models import Application, Entitlement, Role, RoleEntitlement, SoDPolicy, Identity
from ..services import audit, rbac

r = APIRouter(prefix="/catalog", tags=["catalog"])
ADM = require("admin")
class AppIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    owner_id: int | None = None
    sensitive: bool = False
    sla_hours: int = Field(24, ge=1, le=720)
class AppPatch(BaseModel):
    owner_id: int | None = None
    sensitive: bool | None = None
    sla_hours: int | None = Field(None, ge=1, le=720)
class EntIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    sensitive: bool = False
class RoleIn(BaseModel): name: str = Field(min_length=2, max_length=80)
class RoleEnts(BaseModel): entitlement_ids: list[int]
class SoDIn(BaseModel):
    name: str = Field(min_length=3, max_length=120)
    entitlement_a_id: int
    entitlement_b_id: int
    description: str = ""

def _need(db, model, id, what):
    x = db.get(model, id)
    if not x: raise HTTPException(404, f"{what} not found")
    return x
def _unique(db, model, **kw):
    if db.scalar(select(model).filter_by(**kw)): raise HTTPException(409, "Already exists")

@r.post("/applications", status_code=201)
def new_app(b: AppIn, db=Depends(get_db), u=Depends(ADM)):
    _unique(db, Application, name=b.name)
    if b.owner_id: _need(db, Identity, b.owner_id, "Owner")
    a = Application(**b.model_dump()); db.add(a); db.flush()
    audit.log(db, u.employee_id, "application_created", new=b.model_dump()); db.commit(); return {"id": a.id}

@r.patch("/applications/{id}")
def patch_app(id: int, b: AppPatch, db=Depends(get_db), u=Depends(ADM)):
    a = _need(db, Application, id, "Application"); ch = b.model_dump(exclude_unset=True)
    if ch.get("owner_id"): _need(db, Identity, ch["owner_id"], "Owner")
    prev = {k: getattr(a, k) for k in ch}
    for k, v in ch.items(): setattr(a, k, v)
    audit.log(db, u.employee_id, "application_updated", prev=prev, new=ch); db.commit(); return {"id": a.id}

@r.post("/applications/{id}/entitlements", status_code=201)
def new_ent(id: int, b: EntIn, db=Depends(get_db), u=Depends(ADM)):
    _need(db, Application, id, "Application"); _unique(db, Entitlement, application_id=id, name=b.name)
    e = Entitlement(application_id=id, **b.model_dump()); db.add(e); db.flush()
    audit.log(db, u.employee_id, "entitlement_created", new={"app": id} | b.model_dump()); db.commit(); return {"id": e.id}

@r.post("/roles", status_code=201)
def new_role(b: RoleIn, db=Depends(get_db), u=Depends(ADM)):
    _unique(db, Role, name=b.name); x = Role(name=b.name); db.add(x); db.flush()
    audit.log(db, u.employee_id, "role_created", new={"name": b.name}); db.commit(); return {"id": x.id}

@r.put("/roles/{id}/entitlements")
def set_role_ents(id: int, b: RoleEnts, db=Depends(get_db), u=Depends(ADM)):
    _need(db, Role, id, "Role"); ids = set(b.entitlement_ids)
    if len(ids) != len(db.scalars(select(Entitlement.id).where(Entitlement.id.in_(ids))).all()): raise HTTPException(404, "Unknown entitlement")
    bad = [p.name for p in db.scalars(select(SoDPolicy)) if p.entitlement_a_id in ids and p.entitlement_b_id in ids]
    if bad:
        audit.log(db, u.employee_id, "role_design_sod_blocked", outcome="Denied", new={"role": id, "policies": bad}); db.commit()
        raise HTTPException(409, "Role would violate SoD: " + "; ".join(bad))
    prev = sorted(db.scalars(select(RoleEntitlement.entitlement_id).where(RoleEntitlement.role_id == id)))
    db.execute(delete(RoleEntitlement).where(RoleEntitlement.role_id == id))
    for e in ids: db.add(RoleEntitlement(role_id=id, entitlement_id=e))
    audit.log(db, u.employee_id, "role_entitlements_changed", prev={"entitlements": prev}, new={"role": id, "entitlements": sorted(ids)})
    db.commit(); return {"role_id": id, "entitlements": sorted(ids)}

@r.post("/sod", status_code=201)
def new_sod(b: SoDIn, db=Depends(get_db), u=Depends(ADM)):
    if b.entitlement_a_id == b.entitlement_b_id: raise HTTPException(422, "Entitlements must differ")
    for e in (b.entitlement_a_id, b.entitlement_b_id): _need(db, Entitlement, e, "Entitlement")
    _unique(db, SoDPolicy, name=b.name); p = SoDPolicy(**b.model_dump()); db.add(p); db.flush()
    existing = len(rbac.sod_report(db))  # report, do not auto-remove access
    audit.log(db, u.employee_id, "sod_policy_created", new=b.model_dump() | {"existing_violations": existing}); db.commit()
    return {"id": p.id, "existing_violations": existing}

@r.delete("/sod/{id}")
def del_sod(id: int, db=Depends(get_db), u=Depends(ADM)):
    p = _need(db, SoDPolicy, id, "Policy"); audit.log(db, u.employee_id, "sod_policy_deleted", prev={"name": p.name})
    db.delete(p); db.commit(); return {"ok": True}

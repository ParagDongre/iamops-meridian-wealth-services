"""Create the first admin without demo data: BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD (>=12 chars)."""
import os
from datetime import date
from sqlalchemy import select
from .config import get_settings
from .db import make_engine, make_session_factory
from .models import Identity
from .security import hash_pw
from .services import audit

def load_catalog(db):
    from .seed import ROLES, APPS, ROLE_MAP, SOD
    from .models import Role, Application, Entitlement, RoleEntitlement, SoDPolicy
    if db.scalar(select(Role)): return False
    roles = {n: Role(name=n) for n in ROLES}; db.add_all(roles.values()); db.flush(); ents = {}
    for an, (sens, sla, es) in APPS.items():
        a = Application(name=an, sensitive=bool(sens), sla_hours=sla); db.add(a); db.flush()  # assign owners in the catalog UI
        for en, x in es: e = Entitlement(application_id=a.id, name=en, sensitive=bool(x)); db.add(e); db.flush(); ents[en] = e
    for rn, es in ROLE_MAP.items():
        for en in es: db.add(RoleEntitlement(role_id=roles[rn].id, entitlement_id=ents[en].id))
    for n, a, b in SOD: db.add(SoDPolicy(name=n, entitlement_a_id=ents[a].id, entitlement_b_id=ents[b].id, description=n))
    db.commit(); return True

def main():
    e, p = os.environ["BOOTSTRAP_ADMIN_EMAIL"], os.environ["BOOTSTRAP_ADMIN_PASSWORD"]
    if len(p) < 12: raise SystemExit("Password must be at least 12 characters")
    with make_session_factory(make_engine(get_settings().DATABASE_URL))() as db:
        if os.environ.get("BOOTSTRAP_CATALOG") == "1": print("catalog loaded" if load_catalog(db) else "catalog exists")
        if db.scalar(select(Identity).where(Identity.app_role == "admin")): print("admin already exists"); return
        i = Identity(employee_id="ADMIN001", full_name="Platform Admin", email=e, department="IT", job_title="IAM Administrator",
                     joining_date=date.today(), app_role="admin", password_hash=hash_pw(p)); db.add(i); db.flush()
        audit.log(db, "bootstrap", "identity_created", i.id, new={"email": e, "app_role": "admin"}); db.commit(); print("admin created")
if __name__ == "__main__": main()

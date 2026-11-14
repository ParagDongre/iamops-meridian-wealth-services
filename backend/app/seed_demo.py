"""Realistic fictional history for the dashboard. Run after seed: python -m backend.app.seed_demo"""
import random
from datetime import datetime, timedelta
from sqlalchemy import select
from .config import get_settings
from .db import make_engine, make_session_factory
from .models import Identity, Entitlement, AccessRequest, Application, WorkItem, Approval
from .services import requests as rq, tickets, certification as cert
from .connectors import registry

class _Flaky:
    name = "flaky"
    def __init__(s): s.n = 0
    def _f(s):
        s.n += 1
        if s.n % 7 == 0: raise RuntimeError("target system timeout")
    def ensure_account(s, i): s._f(); return "x"
    def add_to_group(s, i, g): s._f()
    def remove_from_group(s, i, g): s._f()
    def disable_account(s, i): s._f()

def run(db, seed=42):
    random.seed(seed); registry.override = [_Flaky()]
    admin = db.scalar(select(Identity).where(Identity.employee_id == "E002"))
    people = db.scalars(select(Identity).where(Identity.app_role == "viewer")).all()
    ents = db.scalars(select(Entitlement)).all()
    for _ in range(40):
        t, e = random.choice(people), random.choice(ents)
        try: r = rq.submit(db, admin, t, e.id, "Demo history", random.choice(["Low", "Medium", "High"]))
        except (ValueError, PermissionError): continue
        for a in db.scalars(select(Approval).where(Approval.request_id == r.id)).all():
            if r.status == "Pending Approval" and random.random() < 0.8:
                ap = db.get(Identity, a.approver_id)
                try: rq.decide(db, ap, r, "Approved")
                except (ValueError, PermissionError): pass
        d = random.randint(0, 13); hrs = db.get(Application, e.application_id).sla_hours
        r.created_at = datetime.utcnow() - timedelta(days=d, hours=random.randint(0, 5)); r.sla_deadline = r.created_at + timedelta(hours=hrs)
        if r.fulfilled_at: r.fulfilled_at = r.created_at + timedelta(hours=random.choice([1, 3, 6, hrs - 2, hrs + 6]))
        for w in db.scalars(select(WorkItem).where(WorkItem.request_id == r.id)): w.created_at, w.sla_deadline = r.created_at, r.sla_deadline
    for p in ("Low", "Medium", "High", "Critical"):
        tickets.create(db, "E002", "Incident", f"Demo {p} incident", "Access", p, random.choice(people).id, auto_assign=True)
    db.commit(); registry.override = None

if __name__ == "__main__":
    with make_session_factory(make_engine(get_settings().DATABASE_URL))() as db: run(db); print("demo history created")

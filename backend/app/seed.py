"""Fictional seed data. Run: python -m backend.app.seed  (needs SEED_PASSWORD in env)."""
import os
from datetime import date
from sqlalchemy import select
from .config import get_settings
from .db import Base, make_engine, make_session_factory
from .models import *
from .security import hash_pw

ROLES = ["Wealth Advisor","Relationship Manager","Operations Analyst","Compliance Analyst",
         "Finance Analyst","System Administrator","External Contractor"]
APPS = {  # name: (sensitive, sla_hours, [(entitlement, sensitive)])
 "Wealth Management Portal": (True, 24, [("Portfolio View",0),("Trade Initiate",1),("Trade Approve",1)]),
 "Customer Relationship Management": (False, 24, [("CRM Read",0),("CRM Edit",0)]),
 "Financial Reporting": (True, 48, [("Report Viewer",0),("Journal Entry Create",1),("Journal Entry Approve",1)]),
 "Compliance Monitoring": (True, 24, [("Alert Viewer",0),("Case Manager",1),("Compliance Admin",1)]),
 "Document Management": (False, 48, [("Doc Read",0),("Doc Write",0)]),
 "HR Management": (True, 48, [("HR Read",0),("Payroll Edit",1),("Payroll Approve",1)]),
}
ROLE_MAP = {
 "Wealth Advisor": ["Portfolio View","Trade Initiate","CRM Read","Doc Read"],
 "Relationship Manager": ["Portfolio View","CRM Read","CRM Edit","Doc Read","Doc Write"],
 "Operations Analyst": ["Portfolio View","Trade Approve","Doc Read","Doc Write"],
 "Compliance Analyst": ["Alert Viewer","Case Manager","Doc Read","Report Viewer"],
 "Finance Analyst": ["Report Viewer","Journal Entry Create","Doc Read"],
 "System Administrator": ["Doc Read","Doc Write","HR Read"],
 "External Contractor": ["Doc Read"],
}
SOD = [("Trade initiation vs approval","Trade Initiate","Trade Approve"),
       ("Journal entry creation vs approval","Journal Entry Create","Journal Entry Approve"),
       ("Payroll edit vs approval","Payroll Edit","Payroll Approve"),
       ("Case management vs compliance administration","Case Manager","Compliance Admin")]
# emp_id, name, dept, title, role, app_role, manager_emp
PEOPLE = [
 ("E001","Asha Verma","Human Resources","HR Director","System Administrator","admin",None),
 ("E002","Rohan Mehta","IT","IAM Operations Lead","System Administrator","admin",None),
 ("E003","Priya Nair","IT","IAM Analyst","System Administrator","analyst","E002"),
 ("E004","Karan Shah","Wealth Management","Head of Wealth","Relationship Manager","approver",None),
 ("E005","Neha Iyer","Wealth Management","Wealth Advisor","Wealth Advisor","viewer","E004"),
 ("E006","Vikram Rao","Wealth Management","Wealth Advisor","Wealth Advisor","viewer","E004"),
 ("E007","Sana Khan","Finance","Finance Manager","Finance Analyst","approver",None),
 ("E008","Dev Patel","Finance","Finance Analyst","Finance Analyst","viewer","E007"),
 ("E009","Meera Joshi","Compliance","Compliance Head","Compliance Analyst","approver",None),
 ("E010","Arjun Singh","Compliance","Compliance Analyst","Compliance Analyst","viewer","E009"),
 ("E011","Lata Desai","Operations","Operations Manager","Operations Analyst","approver",None),
 ("E012","Imran Qureshi","Operations","Operations Analyst","Operations Analyst","viewer","E011"),
 ("E013","Tara Bose","Operations","Contractor Analyst","External Contractor","viewer","E011"),
]

def seed(db, pw):
    if db.scalar(select(Role)): return False
    roles = {n: Role(name=n) for n in ROLES}; db.add_all(roles.values()); db.flush()
    ents = {}
    for an,(sens,sla,es) in APPS.items():
        a = Application(name=an, sensitive=bool(sens), sla_hours=sla); db.add(a); db.flush()
        for en,es_ in es:
            e = Entitlement(application_id=a.id, name=en, sensitive=bool(es_)); db.add(e); db.flush(); ents[en]=e
    for rn, es in ROLE_MAP.items():
        for en in es: db.add(RoleEntitlement(role_id=roles[rn].id, entitlement_id=ents[en].id))
    for n,a,b in SOD:
        db.add(SoDPolicy(name=n, entitlement_a_id=ents[a].id, entitlement_b_id=ents[b].id,
                         description=f"{a} and {b} must not be held together"))
    ids, h = {}, hash_pw(pw)
    for i,(eid,n,d,t,r,ar,m) in enumerate(PEOPLE):
        x = Identity(employee_id=eid, full_name=n, email=n.lower().replace(" ",".")+"@meridian.example",
                     department=d, job_title=t, business_role_id=roles[r].id, app_role=ar,
                     manager_id=ids.get(m), joining_date=date(2022,1,1+i), location="Mumbai",
                     employment_type="Contractor" if r=="External Contractor" else "Employee", password_hash=h)
        db.add(x); db.flush(); ids[eid]=x.id
    for an, eid in {"Wealth Management Portal":"E004","Customer Relationship Management":"E011",
        "Financial Reporting":"E007","Compliance Monitoring":"E009","Document Management":"E011","HR Management":"E001"}.items():
        db.scalar(select(Application).where(Application.name == an)).owner_id = ids[eid]
    db.commit(); return True

if __name__ == "__main__":
    e = make_engine(get_settings().DATABASE_URL); Base.metadata.create_all(e)
    with make_session_factory(e)() as db: print("seeded" if seed(db, os.environ["SEED_PASSWORD"]) else "already seeded")

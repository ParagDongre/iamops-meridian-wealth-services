from sqlalchemy import select
from backend.app.models import Identity, Entitlement, Assignment, AuditEvent
from .conftest import login

def I(db, eid): return db.scalar(select(Identity).where(Identity.employee_id == eid))
def E(db, n): return db.scalar(select(Entitlement).where(Entitlement.name == n)).id
def held(db, eid): return {a.entitlement_id for a in db.scalars(select(Assignment).where(
    Assignment.identity_id == I(db, eid).id, Assignment.status == "Active"))}
def em(n): return n.lower().replace(" ", ".") + "@meridian.example"
NEW = {"employee_id":"E200","full_name":"New Joiner","email":"new.joiner@meridian.example","department":"Wealth Management",
       "job_title":"Wealth Advisor","joining_date":"2025-01-01"}

def approve_all(client, db, rid):
    for n in ("Karan Shah", "Meera Joshi", "Sana Khan", "Lata Desai", "Asha Verma"):
        h = login(client, em(n)); client.post(f"/requests/{rid}/decision", json={"decision":"Approved"}, headers=h)

def test_joiner_requires_approval_before_access(client, admin, db):
    role = I(db, "E005").business_role_id
    r = client.post("/jml/joiner", json=NEW | {"manager_id": I(db,"E004").id, "business_role_id": role}, headers=admin)
    assert r.status_code == 201 and len(r.json()["requests"]) == 4
    nid = r.json()["identity_id"]
    assert all(x["status"] == "Pending Approval" for x in r.json()["requests"])
    assert not db.scalars(select(Assignment).where(Assignment.identity_id == nid)).all()  # no premature grant
    for x in r.json()["requests"]: approve_all(client, db, x["id"])
    assert len(db.scalars(select(Assignment).where(Assignment.identity_id == nid, Assignment.status == "Active")).all()) == 4

def test_rejection_grants_nothing(client, admin, db):
    t = I(db, "E005"); mgr = login(client, em("Karan Shah"))
    rid = client.post("/requests", json={"target_id":t.id,"entitlement_id":E(db,"CRM Read"),"justification":"need crm"}, headers=admin).json()["id"]
    assert client.post(f"/requests/{rid}/decision", json={"decision":"Rejected"}, headers=mgr).status_code == 409  # reason required
    r = client.post(f"/requests/{rid}/decision", json={"decision":"Rejected","comment":"not needed"}, headers=mgr).json()
    assert r["status"] == "Rejected" and E(db, "CRM Read") not in held(db, "E005")

def test_duplicate_and_wrong_approver_and_self_approval(client, admin, db):
    t = I(db, "E005"); b = {"target_id":t.id,"entitlement_id":E(db,"CRM Edit"),"justification":"need edit"}
    rid = client.post("/requests", json=b, headers=admin).json()["id"]
    assert client.post("/requests", json=b, headers=admin).status_code == 409
    other = login(client, em("Sana Khan"))
    assert client.post(f"/requests/{rid}/decision", json={"decision":"Approved"}, headers=other).status_code == 403
    self_ = login(client, em("Neha Iyer"))
    assert client.post(f"/requests/{rid}/decision", json={"decision":"Approved"}, headers=self_).status_code == 403

def test_sod_blocks_request(client, admin, db):
    t = I(db, "E005"); from backend.app.services import rbac
    rbac.grant(db, "t", t, E(db, "Trade Initiate"))
    r = client.post("/requests", json={"target_id":t.id,"entitlement_id":E(db,"Trade Approve"),"justification":"conflict"}, headers=admin)
    assert r.status_code == 403 and "SoD" in r.json()["detail"]

def test_viewer_cannot_request_for_others(client, viewer, db):
    r = client.post("/requests", json={"target_id":I(db,"E006").id,"entitlement_id":E(db,"CRM Read"),"justification":"sneaky"}, headers=viewer)
    assert r.status_code == 403

def test_mover_removes_old_adds_new(client, admin, db):
    from backend.app.services import rbac
    t = I(db, "E005")
    for n in ("Portfolio View", "Trade Initiate", "CRM Read", "Doc Read"): rbac.grant(db, "t", t, E(db, n), "role")
    ops = I(db, "E012").business_role_id
    r = client.post(f"/jml/mover/{t.id}", json={"business_role_id": ops, "job_title": "Ops Analyst"}, headers=admin).json()
    h = held(db, "E005")
    assert E(db, "Trade Initiate") not in h and E(db, "CRM Read") not in h   # no longer required
    assert E(db, "Portfolio View") in h and E(db, "Doc Read") in h            # retained
    assert any(db.scalars(select(AuditEvent).where(AuditEvent.action == "mover_processed")))
    assert {x["action"] for x in r["requests"]} >= {"revoke", "grant"}

def test_leaver_revokes_everything(client, admin, db):
    from backend.app.services import rbac
    t = I(db, "E006"); rbac.grant(db, "t", t, E(db, "CRM Read"))
    pend = client.post("/requests", json={"target_id":t.id,"entitlement_id":E(db,"CRM Edit"),"justification":"pending one"}, headers=admin).json()["id"]
    r = client.post(f"/jml/leaver/{t.id}", headers=admin).json()
    assert r["status"] == "Terminated" and held(db, "E006") == set()
    assert client.get(f"/requests/{pend}", headers=admin).json()["status"] == "Rejected"
    assert client.post(f"/identities/{t.id}/activate", headers=admin).status_code == 409
    assert client.post("/requests", json={"target_id":t.id,"entitlement_id":E(db,"Doc Read"),"justification":"after leave"}, headers=admin).status_code == 403

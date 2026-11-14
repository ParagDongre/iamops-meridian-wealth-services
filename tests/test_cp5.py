from sqlalchemy import select
from backend.app.models import WorkItem, Account, AuditEvent, Assignment
from backend.app.services import provisioning as pv
from .test_cp34 import I, E, held, em, login

def req(client, admin, db, ent="CRM Read", who="E005"):
    return client.post("/requests", json={"target_id": I(db, who).id, "entitlement_id": E(db, ent), "justification": "needs access"}, headers=admin).json()["id"]
def approve(client, rid, *names):
    for n in names: client.post(f"/requests/{rid}/decision", json={"decision": "Approved"}, headers=login(client, em(n)))

def test_success_calls_connector_and_is_idempotent(client, admin, db, fake):
    rid = req(client, admin, db); approve(client, rid, "Karan Shah", "Lata Desai")
    assert client.get(f"/requests/{rid}", headers=admin).json()["status"] == "Fulfilled"
    assert "neha.iyer@meridian.example" in fake.groups["Customer Relationship Management:CRM Read"]
    wi = db.scalar(select(WorkItem)); assert wi.status == "Success"
    pv.run(db, wi); assert pv.enqueue_for_request(db, wi and db.get(__import__("backend.app.models", fromlist=["x"]).AccessRequest, rid)).id == wi.id
    assert len(db.scalars(select(Account)).all()) == 1 and len(db.scalars(select(WorkItem)).all()) == 1

def test_failure_not_reported_as_success_then_retry(client, admin, db, fake):
    fake.fail = True; rid = req(client, admin, db); approve(client, rid, "Karan Shah", "Lata Desai")
    assert client.get(f"/requests/{rid}", headers=admin).json()["status"] == "Failed"
    wi = db.scalar(select(WorkItem)); assert wi.status == "Failed" and "rejected" in wi.error and wi.retry_count == 1
    assert E(db, "CRM Read") not in held(db, "E005")  # no local grant when target failed
    fake.fail = False
    assert client.post(f"/provisioning/work-items/{wi.id}/retry", headers=admin).json()["status"] == "Success"
    assert client.get(f"/requests/{rid}", headers=admin).json()["status"] == "Fulfilled"
    assert E(db, "CRM Read") in held(db, "E005")
    client.post(f"/provisioning/work-items/{wi.id}/retry", headers=admin)  # retry of success = no-op
    assert len(fake.groups["Customer Relationship Management:CRM Read"]) == 1 and len(db.scalars(select(Account)).all()) == 1

def test_escalates_after_max_retries(client, admin, db, fake):
    fake.fail = True; rid = req(client, admin, db); approve(client, rid, "Karan Shah", "Lata Desai")
    wi = db.scalar(select(WorkItem))
    for _ in range(2): pv.retry(db, "t", wi) if wi.status == "Failed" else None
    assert wi.status == "Escalated" and wi.retry_count == 3
    assert db.scalar(select(AuditEvent).where(AuditEvent.action == "escalated_to_l2"))

def test_leaver_disables_external_account(client, admin, db, fake):
    rid = req(client, admin, db); approve(client, rid, "Karan Shah", "Lata Desai")
    r = client.post(f"/jml/leaver/{I(db, 'E005').id}", headers=admin).json()
    assert "neha.iyer@meridian.example" in fake.disabled and r["external_disable_status"] == "Success"
    assert db.scalar(select(Account)).status == "Disabled" and held(db, "E005") == set()

def test_leaver_external_failure_is_visible(client, admin, db, fake):
    fake.fail = True; r = client.post(f"/jml/leaver/{I(db, 'E006').id}", headers=admin).json()
    assert r["external_disable_status"] == "Failed" and r["error"]

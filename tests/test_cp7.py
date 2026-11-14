from datetime import date, timedelta
import pytest
from sqlalchemy import select, delete
from backend.app.models import AuditEvent, CertItem
from backend.app.services import rbac
from .test_cp34 import I, E, held, em, login

def setup_access(db):
    t = I(db, "E005")
    for n in ("Portfolio View", "CRM Read"): rbac.grant(db, "t", t, E(db, n))
    return t

def campaign(client, admin, due=None):
    return client.post("/certification/campaigns", json={"name": "Q4", "due_date": str(due or date.today() + timedelta(days=7))}, headers=admin).json()

def test_campaign_certify_and_revoke(client, admin, db, fake):
    setup_access(db); c = campaign(client, admin); assert c["items"] == 2
    karan = login(client, em("Karan Shah")); items = client.get("/certification/my-reviews", headers=karan).json()
    assert len(items) == 2
    assert client.post(f"/certification/items/{items[0]['id']}/decision", json={"decision": "Certified"}, headers=karan).json()["decision"] == "Certified"
    assert client.post(f"/certification/items/{items[1]['id']}/decision", json={"decision": "Revoked"}, headers=karan).status_code == 409  # justification
    r = client.post(f"/certification/items/{items[1]['id']}/decision", json={"decision": "Revoked", "justification": "role change"}, headers=karan).json()
    assert r["revocation_request_status"] == "Fulfilled" and len(held(db, "E005")) == 1
    s = client.get("/certification/campaigns", headers=admin).json()[0]
    assert (s["total"], s["certified"], s["revoked"], s["pending"]) == (2, 1, 1, 0)

def test_wrong_reviewer_and_redecision(client, admin, db):
    setup_access(db); campaign(client, admin)
    item = db.scalar(select(CertItem)).id; other = login(client, em("Sana Khan"))
    assert client.post(f"/certification/items/{item}/decision", json={"decision": "Certified"}, headers=other).status_code == 403
    karan = login(client, em("Karan Shah"))
    client.post(f"/certification/items/{item}/decision", json={"decision": "Certified"}, headers=karan)
    assert client.post(f"/certification/items/{item}/decision", json={"decision": "Certified"}, headers=karan).status_code == 409

def test_overdue_and_investigate_creates_task(client, admin, db):
    setup_access(db); campaign(client, admin, date.today() - timedelta(days=1))
    assert client.get("/certification/campaigns", headers=admin).json()[0]["overdue"] == 2
    karan = login(client, em("Karan Shah")); item = db.scalar(select(CertItem)).id
    client.post(f"/certification/items/{item}/decision", json={"decision": "Investigate", "justification": "unsure"}, headers=karan)
    assert client.get("/tickets?status=Assigned", headers=admin).json()[0]["ticket_type"] == "Task"

def test_audit_is_append_only(db):
    e = db.scalar(select(AuditEvent)) or None
    from backend.app.services import audit; audit.log(db, "x", "probe"); db.commit()
    e = db.scalar(select(AuditEvent).order_by(AuditEvent.id.desc()))
    e.action = "tampered"
    with pytest.raises(PermissionError): db.commit()
    db.rollback()
    db.delete(e)
    with pytest.raises(PermissionError): db.commit()

def test_audit_search_export_and_injection(client, admin, viewer, db):
    client.post("/identities", json={"employee_id": "E300", "full_name": "=cmd Evil", "email": "evil@meridian.example",
                "department": "IT", "job_title": "x", "joining_date": "2025-01-01"}, headers=admin)
    assert client.get("/audit/events?action=identity_created", headers=admin).json()
    assert client.get("/audit/events", headers=viewer).status_code == 403
    import csv, io
    cells = [c for row in csv.reader(io.StringIO(client.get("/audit/export.csv", headers=admin).text)) for c in row]
    assert "'=cmd Evil" in "".join(cells) or any("cmd Evil" in c for c in cells)
    assert not any(c.startswith("=") for c in cells)
    assert client.get("/audit/events?action=audit_exported", headers=admin).json()

def test_reports(client, admin, db, fake):
    from .test_cp5 import req, approve
    fake.fail = True; rid = req(client, admin, db); approve(client, rid, "Karan Shah", "Lata Desai")
    assert client.get("/audit/reports/failed-provisioning", headers=admin).json()[0]["status"] == "Failed"
    rbac.grant(db, "t", I(db, "E006"), E(db, "Trade Initiate"))
    client.post("/requests", json={"target_id": I(db, "E006").id, "entitlement_id": E(db, "Trade Approve"), "justification": "conflict!"}, headers=admin)
    assert client.get("/audit/reports/sod-violations", headers=admin).json()["blocked_attempts"]

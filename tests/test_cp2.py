from sqlalchemy import select
from backend.app.models import Entitlement, AuditEvent, Identity
from .conftest import PW

NEW = {"employee_id":"E100","full_name":"Test User","email":"test.user@meridian.example",
       "department":"IT","job_title":"Analyst","joining_date":"2025-01-01"}
def ent(db, n): return db.scalar(select(Entitlement).where(Entitlement.name == n)).id

def test_login_fail(client):
    assert client.post("/auth/login", json={"email":"x@y.z","password":"bad"}).status_code == 401
def test_unauthenticated(client): assert client.get("/identities").status_code == 401
def test_create_and_audit(client, admin, db):
    r = client.post("/identities", json=NEW, headers=admin); assert r.status_code == 201
    assert db.scalar(select(AuditEvent).where(AuditEvent.action == "identity_created"))
    assert client.post("/identities", json=NEW, headers=admin).status_code == 409
def test_update_and_history(client, admin):
    i = client.post("/identities", json=NEW, headers=admin).json()["id"]
    client.patch(f"/identities/{i}", json={"job_title":"Senior"}, headers=admin)
    h = client.get(f"/identities/{i}/history", headers=admin).json()
    assert [e["action"] for e in h] == ["identity_created","identity_updated"]
    assert h[1]["previous"]["job_title"] == "Analyst" and h[1]["new"]["job_title"] == "Senior"
def test_rbac_denied_for_viewer(client, viewer, db):
    assert client.post("/identities", json=NEW, headers=viewer).status_code == 403
    assert db.scalar(select(AuditEvent).where(AuditEvent.action == "access_denied"))
def test_search(client, admin):
    assert len(client.get("/identities?department=Finance", headers=admin).json()) == 2
def test_sod_blocked(client, admin, db):
    i = db.scalar(select(Identity).where(Identity.employee_id == "E005")).id
    assert client.post("/rbac/grant", json={"identity_id":i,"entitlement_id":ent(db,"Trade Initiate")}, headers=admin).status_code == 200
    r = client.post("/rbac/grant", json={"identity_id":i,"entitlement_id":ent(db,"Trade Approve")}, headers=admin)
    assert r.status_code == 403 and "SoD" in r.json()["detail"]
    assert client.get("/rbac/sod/report", headers=admin).json() == []
def test_grant_idempotent(client, admin, db):
    i = db.scalar(select(Identity).where(Identity.employee_id == "E005")).id
    b = {"identity_id":i,"entitlement_id":ent(db,"CRM Read")}
    a1 = client.post("/rbac/grant", json=b, headers=admin).json(); a2 = client.post("/rbac/grant", json=b, headers=admin).json()
    assert a1["assignment_id"] == a2["assignment_id"]
def test_deactivated_cannot_login(client, admin, db):
    i = db.scalar(select(Identity).where(Identity.employee_id == "E006")).id
    client.post(f"/identities/{i}/deactivate", headers=admin)
    assert client.post("/auth/login", json={"email":"vikram.rao@meridian.example","password":PW}).status_code == 401

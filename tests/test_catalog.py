from .conftest import PW, login
from .test_cp34 import I

def test_catalog_admin_only(client, viewer): assert client.post("/catalog/roles", json={"name": "Hacker"}, headers=viewer).status_code == 403

def test_create_app_entitlements_role_and_sod(client, admin, db):
    a = client.post("/catalog/applications", json={"name": "Treasury", "sensitive": True}, headers=admin).json()["id"]
    assert client.post("/catalog/applications", json={"name": "Treasury"}, headers=admin).status_code == 409
    e1 = client.post(f"/catalog/applications/{a}/entitlements", json={"name": "Pay Create"}, headers=admin).json()["id"]
    e2 = client.post(f"/catalog/applications/{a}/entitlements", json={"name": "Pay Approve"}, headers=admin).json()["id"]
    role = client.post("/catalog/roles", json={"name": "Treasurer"}, headers=admin).json()["id"]
    assert client.post("/catalog/sod", json={"name": "Pay split", "entitlement_a_id": e1, "entitlement_b_id": e2}, headers=admin).status_code == 201
    bad = client.put(f"/catalog/roles/{role}/entitlements", json={"entitlement_ids": [e1, e2]}, headers=admin)
    assert bad.status_code == 409 and "SoD" in bad.json()["detail"]
    assert client.put(f"/catalog/roles/{role}/entitlements", json={"entitlement_ids": [e1]}, headers=admin).status_code == 200

def test_request_blocked_when_app_has_no_owner(client, admin, db):
    a = client.post("/catalog/applications", json={"name": "Orphan"}, headers=admin).json()["id"]
    e = client.post(f"/catalog/applications/{a}/entitlements", json={"name": "Use"}, headers=admin).json()["id"]
    r = client.post("/requests", json={"target_id": I(db, "E005").id, "entitlement_id": e, "justification": "needs it"}, headers=admin)
    assert r.status_code == 409 and "owner" in r.json()["detail"]

def test_logout_revokes_token(client, viewer):
    assert client.get("/auth/me", headers=viewer).status_code == 200
    client.post("/auth/logout", headers=viewer); assert client.get("/auth/me", headers=viewer).status_code == 401

def test_password_change_revokes_and_enforces_length(client, db):
    h = login(client, "neha.iyer@meridian.example")
    assert client.post("/auth/change-password", json={"old_password": PW, "new_password": "short"}, headers=h).status_code == 422
    assert client.post("/auth/change-password", json={"old_password": PW, "new_password": "a-much-longer-pass-1"}, headers=h).status_code == 200
    assert client.get("/auth/me", headers=h).status_code == 401

def test_deactivation_kills_live_session(client, admin, db):
    h = login(client, "vikram.rao@meridian.example"); client.post(f"/identities/{I(db,'E006').id}/deactivate", headers=admin)
    assert client.get("/auth/me", headers=h).status_code == 401

import pytest
from datetime import datetime
from sqlalchemy import select
from backend.app.config import Settings
from backend.app.models import Identity, AuditEvent
from .conftest import PW

EM = "neha.iyer@meridian.example"
def bad(client, n=1):
    return [client.post("/auth/login", json={"email": EM, "password": "wrong"}).status_code for _ in range(n)]

def test_lockout_after_threshold(client, db):
    assert bad(client, 5) == [401] * 5
    assert client.post("/auth/login", json={"email": EM, "password": PW}).status_code == 401  # locked even with right pw
    u = db.scalar(select(Identity).where(Identity.email == EM)); assert u.locked_until > datetime.utcnow()
    assert db.scalar(select(AuditEvent).where(AuditEvent.action == "account_locked"))

def test_success_resets_counter(client, db):
    bad(client, 3); assert client.post("/auth/login", json={"email": EM, "password": PW}).status_code == 200
    assert db.scalar(select(Identity).where(Identity.email == EM)).failed_logins == 0

def test_rate_limit(client, monkeypatch):
    monkeypatch.setenv("LOGIN_RATE_PER_MIN", "3")
    assert [client.post("/auth/login", json={"email": "no@x.y", "password": "x"}).status_code for _ in range(5)] == [401, 401, 401, 429, 429]

def test_security_headers_and_ready(client):
    r = client.get("/health/ready")
    assert r.status_code == 200 and r.headers["x-content-type-options"] == "nosniff" and r.headers["x-frame-options"] == "DENY" and r.headers["x-request-id"]

def test_prod_refuses_unsafe_config():
    for kw in ({"JWT_SECRET": "short"}, {"JWT_SECRET": "x" * 40, "DATABASE_URL": "sqlite://"}, {"JWT_SECRET": "change_me" + "x" * 40, "DATABASE_URL": "postgresql://a:b@h/d"}):
        with pytest.raises(ValueError): Settings(ENV="prod", **{"DATABASE_URL": "postgresql://a:b@h/d"} | kw)
    Settings(ENV="prod", JWT_SECRET="k" * 40, DATABASE_URL="postgresql://a:Zx9@h/d")

def test_unhandled_error_hides_details(client, monkeypatch):
    from backend.app import main
    @main.app.get("/_boom")
    def boom(): raise RuntimeError("secret internals")
    r = client.get("/_boom"); assert r.status_code == 500 and "secret" not in r.text

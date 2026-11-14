import os
os.environ.setdefault("JWT_SECRET", "test-secret"); os.environ["DATABASE_URL"] = "sqlite://"
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlalchemy import create_engine
from backend.app.db import Base, make_session_factory
from backend.app.main import app
from backend.app.deps import get_db
from backend.app.seed import seed

PW = "demo-pass-123"

@pytest.fixture
def db():
    e = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(e); s = make_session_factory(e)(); seed(s, PW); yield s; s.close()

@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    yield TestClient(app); app.dependency_overrides.clear()

def login(client, email):
    r = client.post("/auth/login", json={"email": email, "password": PW})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}

@pytest.fixture
def admin(client): return login(client, "rohan.mehta@meridian.example")
@pytest.fixture
def viewer(client): return login(client, "neha.iyer@meridian.example")

from .fakes import FakeConnector
from backend.app.connectors import registry

@pytest.fixture(autouse=True)
def fake():
    f = FakeConnector(); registry.override = [f]; yield f; registry.override = None

os.environ["LOGIN_RATE_PER_MIN"] = "100000"
@pytest.fixture(autouse=True)
def _reset_rate():
    from backend.app.main import _hits; _hits.clear(); yield

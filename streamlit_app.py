"""Streamlit Community Cloud entrypoint: UI + backend in ONE process (demo mode).
Secrets (Streamlit 'Secrets' panel, TOML): JWT_SECRET, SEED_PASSWORD, DATABASE_URL (free Postgres e.g. Neon; omit for throwaway SQLite)."""
import os, sys, runpy
from pathlib import Path
import streamlit as st

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))
try:
    for k, v in st.secrets.items():
        if isinstance(v, str): os.environ.setdefault(k, v)
except Exception: pass  # no secrets file locally; use real env vars
os.environ.setdefault("CONNECTORS", "none")           # no Keycloak/LDAP in demo mode
os.environ.setdefault("ENV", "dev")
os.environ.setdefault("LOGIN_RATE_PER_MIN", "1000")   # in-process calls share one client IP; per-account lockout still applies
os.environ.setdefault("DATABASE_URL", "sqlite:////tmp/iamops_demo.db")
for need in ("JWT_SECRET", "SEED_PASSWORD"):
    if not os.environ.get(need): st.error(f"Missing secret: {need}"); st.stop()

@st.cache_resource
def bootstrap():
    from backend.app.config import get_settings
    from backend.app.db import Base, make_engine, make_session_factory, install_audit_guard
    from backend.app.seed import seed
    from backend.app import seed_demo
    e = make_engine(get_settings().DATABASE_URL); Base.metadata.create_all(e); install_audit_guard(e)
    with make_session_factory(e)() as db:
        if seed(db, os.environ["SEED_PASSWORD"]): seed_demo.run(db)
    return True
bootstrap()
runpy.run_path(str(ROOT / "frontend" / "app.py"), run_name="__main__")

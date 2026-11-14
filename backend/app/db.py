from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

class Base(DeclarativeBase):
    pass

def make_engine(url: str):
    return create_engine(url, pool_pre_ping=True, future=True)

def make_session_factory(engine):
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

_PG_GUARD = ["""CREATE OR REPLACE FUNCTION audit_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_events is append-only'; END; $$ LANGUAGE plpgsql""",
 "DROP TRIGGER IF EXISTS audit_no_mod ON audit_events",
 """CREATE TRIGGER audit_no_mod BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION audit_immutable()"""]

def install_audit_guard(engine):
    """DB-level append-only enforcement (PostgreSQL only; SQLite relies on the ORM guard)."""
    if engine.dialect.name != "postgresql": return
    from sqlalchemy import text
    with engine.begin() as c:
        for q in _PG_GUARD: c.execute(text(q))

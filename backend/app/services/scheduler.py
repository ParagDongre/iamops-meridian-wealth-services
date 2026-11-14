"""Background SLA sweep. Safe with several API replicas on PostgreSQL (advisory lock)."""
import logging, threading
from sqlalchemy import text
from . import tickets
log = logging.getLogger("iamops.scheduler")

def _tick(factory):
    with factory() as db:
        if db.bind.dialect.name == "postgresql" and not db.scalar(text("select pg_try_advisory_lock(727272)")): return
        try: log.info("sla_sweep %s", tickets.sla_sweep(db, "scheduler"))
        finally:
            if db.bind.dialect.name == "postgresql": db.execute(text("select pg_advisory_unlock(727272)")); db.commit()

def start(factory, minutes: int):
    if minutes <= 0: return None
    stop = threading.Event()
    def loop():
        while not stop.wait(minutes * 60):
            try: _tick(factory)
            except Exception: log.exception("sweep failed")
    threading.Thread(target=loop, daemon=True, name="sla-sweeper").start(); return stop

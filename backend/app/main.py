import json, logging, time, uuid
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from .config import get_settings
from .db import Base, make_engine, install_audit_guard
from . import models  # noqa: F401
from .deps import _sf
from .routers import (auth, identities, rbac, workflows, provisioning as prov_router, tickets as tix_router,
                      certification as cert_router, audit as audit_router, reports as rep_router, catalog as cat_router)
from .services import scheduler

class _Json(logging.Formatter):
    def format(self, r): return json.dumps({"t": self.formatTime(r), "lvl": r.levelname, "logger": r.name, "msg": r.getMessage()})
_h = logging.StreamHandler(); _h.setFormatter(_Json()); logging.basicConfig(level=logging.INFO, handlers=[_h], force=True)
log = logging.getLogger("iamops")

@asynccontextmanager
async def lifespan(app):
    s = get_settings()
    if s.ENV != "prod":  # prod schema is managed by Alembic (python -m backend.app.migrate)
        e = make_engine(s.DATABASE_URL); Base.metadata.create_all(e); install_audit_guard(e)
    stop = scheduler.start(_sf(), s.SLA_SWEEP_MINUTES)
    yield
    if stop: stop.set()

_s = get_settings()
app = FastAPI(title="IAMOps API", version="1.0.0", lifespan=lifespan,
              docs_url="/docs" if _s.ENABLE_DOCS or _s.ENV != "prod" else None,
              redoc_url=None, openapi_url="/openapi.json" if _s.ENABLE_DOCS or _s.ENV != "prod" else None)
_hits: dict[str, deque] = defaultdict(deque)

@app.middleware("http")
async def guard(request: Request, call_next):
    s, rid, t0 = get_settings(), uuid.uuid4().hex[:12], time.time()
    ip = (request.headers.get("x-forwarded-for", "").split(",")[0].strip() if s.ENV == "prod" else "") or (request.client.host if request.client else "?")
    if request.method == "POST" and request.url.path == "/auth/login":
        q = _hits[ip]; now = time.time()
        while q and now - q[0] > 60: q.popleft()
        if len(q) >= s.LOGIN_RATE_PER_MIN: return JSONResponse({"detail": "Too many attempts"}, 429)
        q.append(now)
    try: resp = await call_next(request)
    except Exception:
        log.exception("unhandled rid=%s %s %s", rid, request.method, request.url.path)
        resp = JSONResponse({"detail": "Internal error", "request_id": rid}, 500)  # no stack traces to clients
    resp.headers.update({"X-Request-ID": rid, "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
                         "Referrer-Policy": "no-referrer", "Cache-Control": "no-store",
                         "Strict-Transport-Security": "max-age=31536000; includeSubDomains"})
    log.info("rid=%s %s %s %s %.0fms", rid, request.method, request.url.path, resp.status_code, (time.time() - t0) * 1000)
    return resp

@app.get("/health")
def health(): return {"status": "ok"}

@app.get("/health/ready")
def ready():
    try:
        with _sf()() as db: db.execute(text("select 1"))
        return {"status": "ready"}
    except Exception: return JSONResponse({"status": "db_unavailable"}, 503)

for m in (auth, identities, rbac, workflows, prov_router, tix_router, cert_router, audit_router, rep_router, cat_router): app.include_router(m.r)

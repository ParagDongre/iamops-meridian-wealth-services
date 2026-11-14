from functools import lru_cache
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from .config import get_settings
from .db import make_engine, make_session_factory
from .models import Identity
from .security import read_token
from .services import audit

@lru_cache
def _sf():
    return make_session_factory(make_engine(get_settings().DATABASE_URL))

def get_db():
    db = _sf()()
    try: yield db
    finally: db.close()

_bearer = HTTPBearer(auto_error=False)

def current_user(c: HTTPAuthorizationCredentials | None = Depends(_bearer), db=Depends(get_db)) -> Identity:
    tok = read_token(c.credentials) if c else None
    u = db.get(Identity, tok[0]) if tok else None
    if not u or u.lifecycle_status != "Active" or u.token_version != tok[1]:
        raise HTTPException(401, "Not authenticated")
    return u

def require(*roles: str):
    """Backend RBAC for platform roles: admin / analyst / approver / viewer."""
    def dep(u: Identity = Depends(current_user), db=Depends(get_db)):
        if u.app_role not in roles:
            audit.log(db, u.employee_id, "access_denied", outcome="Denied",
                      new_state={"required": list(roles), "had": u.app_role})
            db.commit()
            raise HTTPException(403, "Insufficient privileges")
        return u
    return dep

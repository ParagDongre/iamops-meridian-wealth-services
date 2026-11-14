from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from ..config import get_settings
from ..deps import get_db, current_user
from ..models import Identity
from ..schemas import Login
from ..security import verify_pw, make_token, hash_pw
from pydantic import BaseModel, Field
from ..services import audit

r = APIRouter(prefix="/auth", tags=["auth"])

@r.post("/login")
def login(b: Login, db=Depends(get_db)):
    s, now = get_settings(), datetime.utcnow()
    u = db.scalar(select(Identity).where(Identity.email == b.email))
    if u and u.locked_until and u.locked_until > now:  # locked: do not even check the password
        audit.log(db, b.email, "login", u.id, outcome="Denied", new={"reason": "locked"}); db.commit()
        raise HTTPException(401, "Invalid credentials")
    ok = bool(u) and u.lifecycle_status == "Active" and verify_pw(b.password, u.password_hash)
    if u and ok: u.failed_logins, u.locked_until = 0, None
    elif u:
        u.failed_logins += 1
        if u.failed_logins >= s.LOCKOUT_THRESHOLD:
            u.locked_until, u.failed_logins = now + timedelta(minutes=s.LOCKOUT_MINUTES), 0
            audit.log(db, b.email, "account_locked", u.id, outcome="Denied")
    audit.log(db, b.email, "login", u.id if u else None, outcome="Success" if ok else "Failed")
    db.commit()
    if not ok: raise HTTPException(401, "Invalid credentials")  # generic: no user enumeration
    return {"access_token": make_token(u.id, tv=u.token_version), "token_type": "bearer", "app_role": u.app_role}

@r.get("/me")
def me(u=Depends(current_user)): return {"id": u.id, "email": u.email, "app_role": u.app_role}

class PwChange(BaseModel):
    old_password: str
    new_password: str = Field(min_length=12, max_length=128)

@r.post("/logout")
def logout(u=Depends(current_user), db=Depends(get_db)):
    u.token_version += 1; audit.log(db, u.employee_id, "logout", u.id); db.commit(); return {"ok": True}  # revokes all tokens

@r.post("/change-password")
def change_pw(b: PwChange, u=Depends(current_user), db=Depends(get_db)):
    if not verify_pw(b.old_password, u.password_hash): raise HTTPException(401, "Invalid credentials")
    u.password_hash = hash_pw(b.new_password); u.token_version += 1
    audit.log(db, u.employee_id, "password_changed", u.id); db.commit(); return {"ok": True}

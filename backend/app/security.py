import bcrypt
from datetime import datetime, timedelta
from jose import jwt, JWTError
from .config import get_settings

def hash_pw(p: str) -> str: return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()
def verify_pw(p: str, h: str | None) -> bool:
    return bool(h) and bcrypt.checkpw(p.encode(), h.encode())
def make_token(sub: int, minutes=None, tv: int = 0) -> str:
    minutes = minutes or get_settings().TOKEN_MINUTES
    return jwt.encode({"sub": str(sub), "tv": tv, "exp": datetime.utcnow() + timedelta(minutes=minutes)},
                      get_settings().JWT_SECRET, algorithm="HS256")
def read_token(t: str):
    """Returns (identity_id, token_version) or None."""
    try:
        d = jwt.decode(t, get_settings().JWT_SECRET, algorithms=["HS256"]); return int(d["sub"]), int(d.get("tv", 0))
    except (JWTError, KeyError, ValueError): return None

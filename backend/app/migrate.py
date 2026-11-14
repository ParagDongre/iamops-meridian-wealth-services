"""Run before starting the API in production: python -m backend.app.migrate"""
from pathlib import Path
from alembic import command
from alembic.config import Config
from .config import get_settings
from .db import make_engine, install_audit_guard

def main():
    root = Path(__file__).resolve().parents[2]
    cfg = Config(str(root / "alembic.ini")); cfg.set_main_option("script_location", str(root / "alembic"))
    command.upgrade(cfg, "head"); install_audit_guard(make_engine(get_settings().DATABASE_URL)); print("migrated")
if __name__ == "__main__": main()

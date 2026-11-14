from alembic import context
from sqlalchemy import create_engine, pool
from backend.app.config import get_settings
from backend.app.db import Base
from backend.app import models  # noqa: F401

with create_engine(get_settings().DATABASE_URL, poolclass=pool.NullPool).connect() as c:
    context.configure(connection=c, target_metadata=Base.metadata, compare_type=True)
    with context.begin_transaction(): context.run_migrations()

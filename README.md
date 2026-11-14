# IAMOps — IAM Operations Lab (Meridian Wealth Services, fictional)
Real: PostgreSQL, Keycloak, OpenLDAP, FastAPI, Streamlit. Simulated: SailPoint-style queue, ServiceNow-style tickets. Docs in `docs/`.
## Run (Windows, Docker Desktop, Python 3.11+)
```
copy .env.example .env          # set every secret; add CONNECTORS=keycloak,ldap for live mode
docker compose up -d
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
python -m backend.app.seed && python -m backend.app.seed_demo    # needs SEED_PASSWORD
uvicorn backend.app.main:app --reload                            # http://localhost:8000/docs
streamlit run frontend/app.py                                    # http://localhost:8501
```
Login: `rohan.mehta@meridian.example` (admin) + SEED_PASSWORD. Approvers: `karan.shah@`, `meera.joshi@`, `sana.khan@`, `lata.desai@meridian.example`. Tests: `pytest -q tests`. Live connector tests: `RUN_INTEGRATION=1`. Local development only.

Production deploy: see docs/DEPLOYMENT.md (docker-compose.prod.yml, Caddy TLS, Alembic, lockout, rate limit, SLA scheduler).

Free hosted demo (UI + backend in one Streamlit process): see docs/STREAMLIT_CLOUD.md.

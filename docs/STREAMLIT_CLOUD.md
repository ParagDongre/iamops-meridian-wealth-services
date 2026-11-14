# Free demo on Streamlit Community Cloud (single process)
`streamlit_app.py` runs the FastAPI backend **inside** the Streamlit process (no separate server). 
1. Push the repo to GitHub (`.env` must not be committed).
2. share.streamlit.io -> New app -> your repo, branch `main`, main file `streamlit_app.py`.
3. Advanced settings -> Python 3.12, Secrets: copy `.streamlit_secrets.example.toml` and set real values.
4. Deploy. First start creates tables and seeds the fictional company + demo history.
Login: `rohan.mehta@meridian.example` (admin) with your SEED_PASSWORD; approvers `karan.shah@`, `meera.joshi@`, `sana.khan@`, `lata.desai@meridian.example`.
## What this mode is NOT
- No Keycloak / OpenLDAP: `CONNECTORS=none`, so provisioning updates the local database only (each work item says so). Do not present it as live IdP/LDAP integration. Show the Docker stack locally for that.
- Without `DATABASE_URL`, data resets on app restart. Free tiers sleep when idle; limits and terms change, check Streamlit's current docs.
- Public demo: fictional data only, use a throwaway database and a unique demo password.

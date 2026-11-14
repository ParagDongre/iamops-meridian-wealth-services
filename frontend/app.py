"""IAMOps operations console (Streamlit). Talks ONLY to the FastAPI backend; holds no secrets besides the user's session token."""
import os, requests, pandas as pd, streamlit as st

API = os.environ.get("API_URL", "")  # empty = run the backend in-process (Streamlit Cloud mode)

@st.cache_resource
def _local_client():
    from fastapi.testclient import TestClient
    from backend.app.main import app
    return TestClient(app)

def raw(method, path, headers=None, **kw):
    """One transport for both modes: HTTP to API_URL, or in-process call into the FastAPI app."""
    if API: return requests.request(method, API + path, headers=headers, timeout=20, **kw)
    return _local_client().request(method, path, headers=headers, **kw)
st.set_page_config(page_title="IAMOps", layout="wide")

def api(method, path, **kw):
    h = {"Authorization": f"Bearer {st.session_state['token']}"}
    try: r = raw(method, path, headers=h, **kw)
    except Exception: st.error("API unreachable"); return None
    if r.status_code == 401: st.session_state.clear(); st.warning("Session expired, please sign in again."); st.stop()
    if r.status_code >= 400:
        st.error(f"{r.status_code}: {r.json().get('detail', r.text) if r.headers.get('content-type','').startswith('application/json') else r.text}"); return None
    return r.json() if "json" in r.headers.get("content-type", "") else r.text

def table(rows, **kw):
    if rows: st.dataframe(pd.DataFrame(rows), width="stretch", hide_index=True, **kw)
    else: st.info("No records")
def act(label, method, path, ok="Done", **kw):
    if st.button(label, key=f"{label}{path}"):
        if (r := api(method, path, **kw)) is not None: st.success(ok); return r

if "token" not in st.session_state:
    st.title("IAMOps — Meridian Wealth Services (fictional demo)")
    with st.form("login"):
        e, p = st.text_input("Email"), st.text_input("Password", type="password")
        if st.form_submit_button("Sign in"):
            r = raw("POST", "/auth/login", json={"email": e, "password": p})
            if r.status_code == 200: st.session_state.update(token=r.json()["access_token"], role=r.json()["app_role"], email=e); st.rerun()
            else: st.error("Invalid credentials")
    st.stop()

PAGES = ["Executive Overview", "Identity Directory", "Joiner / Mover / Leaver", "Access Requests", "Provisioning Queue",
         "Application & Entitlement Registry", "Tickets & Incidents", "Access Certification", "Audit & Compliance",
         "SLA & Performance Reports", "System Configuration"]
page = st.sidebar.radio("Navigation", PAGES)
st.sidebar.caption(f"{st.session_state['email']} ({st.session_state['role']})")
if st.sidebar.button("Sign out"): api("POST", "/auth/logout"); st.session_state.clear(); st.rerun()
st.title(page)
ops = st.session_state["role"] in ("admin", "analyst")

def charts(m):
    c1, c2 = st.columns(2)
    for col, key, title in ((c1, "request_volume_by_day", "Requests by day"), (c2, "ticket_priority", "Ticket priority"),
                            (c1, "sla_by_application", "SLA % by application"), (c2, "workitem_ageing", "Work-item ageing"),
                            (c1, "analyst_workload", "Analyst workload")):
        with col:
            st.caption(title); d = m.get(key)
            if d: st.bar_chart(pd.Series(d))
    st.caption("Provisioning success/failure by day")
    if m["provisioning_by_day"]: st.line_chart(pd.DataFrame(m["provisioning_by_day"]).T)

if page in ("Executive Overview", "SLA & Performance Reports"):
    if (m := api("GET", "/reports/metrics")):
        k = m["kpis"]; cols = st.columns(4)
        for n, (key, v) in enumerate(k.items()): cols[n % 4].metric(key.replace("_", " ").title(), v)
        with st.expander("KPI sources (traceability)"): st.json(m["sources"])
        charts(m)
        if page.startswith("SLA") and ops and st.button("Run SLA sweep (escalate breached tickets)"): st.json(api("POST", "/tickets/sla-sweep"))

elif page == "Identity Directory":
    c = st.columns(3); q = c[0].text_input("Search"); d = c[1].text_input("Department"); s = c[2].selectbox("Status", ["", "Active", "Disabled"])
    rows = api("GET", "/identities", params={k: v for k, v in dict(q=q, department=d, status=s).items() if v}) or []
    table(rows)
    if rows:
        sel = st.selectbox("Identity", [f"{r['id']} · {r['full_name']}" for r in rows]); iid = int(sel.split(" ")[0])
        t1, t2, t3 = st.tabs(["Access", "Pending requests", "History"])
        with t1: table(api("GET", f"/identities/{iid}/access"))
        with t2: table(api("GET", f"/identities/{iid}/requests"))
        with t3:
            if ops: table(api("GET", f"/identities/{iid}/history"))
        if st.session_state["role"] == "admin":
            a, b = st.columns(2)
            with a: act("Activate", "POST", f"/identities/{iid}/activate")
            with b: act("Deactivate", "POST", f"/identities/{iid}/deactivate")

elif page == "Joiner / Mover / Leaver":
    if not ops: st.warning("Operations role required"); st.stop()
    roles = api("GET", "/rbac/roles") or []; rmap = {r["name"]: r["id"] for r in roles}
    j, m_, l = st.tabs(["Joiner", "Mover", "Leaver"])
    with j, st.form("joiner"):
        f = {k: st.text_input(k) for k in ("employee_id", "full_name", "email", "department", "job_title", "location")}
        role = st.selectbox("Business role", list(rmap)); mgr = st.number_input("Manager identity id (0 = none)", 0)
        jd = st.date_input("Joining date")
        if st.form_submit_button("Create joiner & raise access requests"):
            r = api("POST", "/jml/joiner", json=f | {"business_role_id": rmap[role], "manager_id": mgr or None, "joining_date": str(jd)})
            if r: st.success(f"Identity {r['identity_id']} created; {len(r['requests'])} requests raised"); table(r["requests"]); st.json(r["skipped"])
    with m_:
        mid = st.number_input("Identity id", 1, key="mid"); nr = st.selectbox("New business role", ["(unchanged)"] + list(rmap)); nt = st.text_input("New job title")
        nd = st.text_input("New department")
        if st.button("Apply mover"):
            ch = {k: v for k, v in dict(job_title=nt, department=nd).items() if v}
            if nr != "(unchanged)": ch["business_role_id"] = rmap[nr]
            if (r := api("POST", f"/jml/mover/{mid}", json=ch)): table(r["requests"]); st.json({"skipped": r["skipped"], "review_required": r["review_required"]})
    with l:
        lid = st.number_input("Identity id", 1, key="lid"); st.warning("Terminates identity, revokes all access, disables accounts. Irreversible.")
        if st.session_state["role"] == "admin" and st.checkbox("I confirm") and st.button("Run leaver"): st.json(api("POST", f"/jml/leaver/{lid}"))

elif page == "Access Requests":
    st.subheader("My pending approvals"); mine = api("GET", "/requests/my-approvals") or []; table(mine)
    for r in mine:
        c = st.columns([1, 3, 1, 1]); c[0].write(f"#{r['id']}"); cm = c[1].text_input("Comment / rejection reason", key=f"c{r['id']}")
        if c[2].button("Approve", key=f"a{r['id']}"): api("POST", f"/requests/{r['id']}/decision", json={"decision": "Approved", "comment": cm}); st.rerun()
        if c[3].button("Reject", key=f"r{r['id']}"): api("POST", f"/requests/{r['id']}/decision", json={"decision": "Rejected", "comment": cm}); st.rerun()
    st.subheader("Submit request")
    apps = api("GET", "/rbac/applications") or []; emap = {f"{a['name']} · {e['name']}": e["id"] for a in apps for e in a["entitlements"]}
    with st.form("req"):
        t = st.number_input("Target identity id", 1); e = st.selectbox("Entitlement", list(emap)); j = st.text_area("Business justification")
        p = st.selectbox("Priority", ["Low", "Medium", "High", "Critical"]); ac = st.selectbox("Action", ["grant", "revoke"])
        if st.form_submit_button("Submit") and (r := api("POST", "/requests", json=dict(target_id=t, entitlement_id=emap[e], justification=j, priority=p, action=ac))): st.success(f"Request #{r['id']}: {r['status']}")
    if ops:
        st.subheader("All requests"); stt = st.selectbox("Status filter", ["", "Pending Approval", "Fulfilled", "Failed", "Rejected"]); table(api("GET", "/requests", params={"status": stt} if stt else {}))
        rid = st.number_input("Request detail id", 1)
        if st.button("Show detail"): st.json(api("GET", f"/requests/{rid}"))

elif page == "Provisioning Queue":
    if not ops: st.warning("Operations role required"); st.stop()
    stt = st.selectbox("Status", ["", "Queued", "Success", "Failed", "Escalated"]); table(api("GET", "/provisioning/work-items", params={"status": stt} if stt else {}))
    w = st.number_input("Work item id", 1); n = st.text_input("Escalation notes"); a, b = st.columns(2)
    with a: act("Retry", "POST", f"/provisioning/work-items/{w}/retry")
    with b:
        if n: act("Escalate to L2", "POST", f"/provisioning/work-items/{w}/escalate", json={"notes": n})

elif page == "Application & Entitlement Registry":
    for a in api("GET", "/rbac/applications") or []:
        with st.expander(f"{a['name']} (sensitive={a['sensitive']}, SLA {a['sla_hours']}h)"): table(a["entitlements"])
    st.subheader("Roles"); table([{"role": r["name"], "entitlements": ", ".join(r["entitlements"])} for r in api("GET", "/rbac/roles") or []])
    st.subheader("SoD policies"); table(api("GET", "/rbac/sod/policies"))
    if ops: st.subheader("Active SoD violations"); table(api("GET", "/rbac/sod/report"))
    if st.session_state["role"] == "admin":
        st.subheader("Catalog administration")
        t = st.tabs(["Application", "Entitlement", "Role", "SoD policy"]); apps = api("GET", "/rbac/applications") or []
        amap = {a["name"]: a["id"] for a in apps}; emap = {f"{a['name']} · {e['name']}": e["id"] for a in apps for e in a["entitlements"]}
        with t[0], st.form("na"):
            n = st.text_input("Name"); o = st.number_input("Owner identity id (0 = none)", 0); sv = st.checkbox("Sensitive"); h = st.number_input("SLA hours", 1, 720, 24)
            if st.form_submit_button("Create application"): api("POST", "/catalog/applications", json=dict(name=n, owner_id=o or None, sensitive=sv, sla_hours=h))
        with t[0], st.form("oa"):
            a = st.selectbox("Application", list(amap)); o = st.number_input("New owner identity id", 1)
            if st.form_submit_button("Set owner"): api("PATCH", f"/catalog/applications/{amap[a]}", json={"owner_id": o})
        with t[1], st.form("ne"):
            a = st.selectbox("Application ", list(amap)); n = st.text_input("Entitlement name"); sv = st.checkbox("Sensitive ")
            if st.form_submit_button("Create entitlement"): api("POST", f"/catalog/applications/{amap[a]}/entitlements", json=dict(name=n, sensitive=sv))
        with t[2], st.form("nr"):
            n = st.text_input("New role name")
            if st.form_submit_button("Create role"): api("POST", "/catalog/roles", json={"name": n})
        roles = api("GET", "/rbac/roles") or []
        with t[2], st.form("rr"):
            rl = st.selectbox("Role", [x["name"] for x in roles]); es = st.multiselect("Entitlements (replaces set)", list(emap))
            if st.form_submit_button("Save role entitlements"): api("PUT", f"/catalog/roles/{ {x['name']: x['id'] for x in roles}[rl] }/entitlements", json={"entitlement_ids": [emap[e] for e in es]})
        with t[3], st.form("ns"):
            n = st.text_input("Policy name"); a = st.selectbox("Entitlement A", list(emap)); b = st.selectbox("Entitlement B", list(emap))
            if st.form_submit_button("Create SoD policy") and (r := api("POST", "/catalog/sod", json=dict(name=n, entitlement_a_id=emap[a], entitlement_b_id=emap[b]))): st.warning(f"Existing violations: {r['existing_violations']}")

elif page == "Tickets & Incidents":
    if ops:
        c = st.columns(2); s = c[0].selectbox("Status", ["", "New", "Assigned", "In Progress", "Resolved", "Closed"]); pr = c[1].selectbox("Priority", ["", "Low", "Medium", "High", "Critical"])
        table(api("GET", "/tickets", params={k: v for k, v in dict(status=s, priority=pr).items() if v}))
        tid = st.number_input("Ticket id", 1)
        if st.button("Open"): st.json(api("GET", f"/tickets/{tid}"))
        a, b, c3 = st.columns(3)
        with a:
            ns = st.selectbox("New status", ["In Progress", "Resolved", "Closed", "Assigned"]); nt = st.text_input("Resolution notes")
            act("Set status", "POST", f"/tickets/{tid}/status", json={"status": ns, "notes": nt or None})
        with b:
            asg = st.number_input("Assignee id", 1); act("Assign", "POST", f"/tickets/{tid}/assign", json={"assignee_id": asg})
        with c3:
            cm = st.text_input("Comment")
            if cm: act("Add comment", "POST", f"/tickets/{tid}/comments", json={"body": cm})
    with st.form("tk"):
        ty = st.selectbox("Type", ["Request", "Incident", "Task"] if ops else ["Request"]); d = st.text_area("Description"); p = st.selectbox("Priority", ["Low", "Medium", "High", "Critical"])
        if st.form_submit_button("Create ticket") and (r := api("POST", "/tickets", json=dict(ticket_type=ty, description=d, priority=p))): st.success(f"Ticket #{r['id']}")
    st.caption("Custom ITSM simulation — not ServiceNow.")

elif page == "Access Certification":
    mine = api("GET", "/certification/my-reviews") or []; st.subheader("My reviews"); table(mine)
    if mine:
        iid = st.selectbox("Item", [x["id"] for x in mine]); d = st.selectbox("Decision", ["Certified", "Revoked", "Investigate", "Inappropriate"]); j = st.text_input("Justification")
        act("Submit decision", "POST", f"/certification/items/{iid}/decision", json={"decision": d, "justification": j or None})
    if ops:
        st.subheader("Campaigns"); table(api("GET", "/certification/campaigns"))
        if st.session_state["role"] == "admin":
            with st.form("camp"):
                n = st.text_input("Name"); due = st.date_input("Due date")
                if st.form_submit_button("Launch campaign") and (r := api("POST", "/certification/campaigns", json=dict(name=n, due_date=str(due)))): st.success(f"{r['items']} items")

elif page == "Audit & Compliance":
    if not ops: st.warning("Operations role required"); st.stop()
    c = st.columns(3); ac = c[0].text_input("Action"); ao = c[1].text_input("Actor"); oc = c[2].selectbox("Outcome", ["", "Success", "Failed", "Denied"])
    table(api("GET", "/audit/events", params={k: v for k, v in dict(action=ac, actor=ao, outcome=oc).items() if v}))
    if st.session_state["role"] == "admin" and (csv := api("GET", "/audit/export.csv")): st.download_button("Export CSV evidence", csv, "audit_evidence.csv", "text/csv")
    t = st.tabs(["Failed provisioning", "SoD", "Access review"])
    with t[0]: table(api("GET", "/audit/reports/failed-provisioning"))
    with t[1]: st.json(api("GET", "/audit/reports/sod-violations"))
    with t[2]: table(api("GET", "/audit/reports/access-review"))
    st.caption("Audit logs are evidence of implemented controls, not proof of regulatory compliance. See SECURITY_CONTROLS.md.")

elif page == "System Configuration":
    if st.session_state["role"] != "admin": st.warning("Admin only"); st.stop()
    st.json(api("GET", "/reports/system")); st.info("Secrets are read from .env by the backend only. No credentials are shown here.")

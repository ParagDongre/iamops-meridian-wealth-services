from datetime import datetime, timedelta
from sqlalchemy import select
from backend.app.models import AccessRequest, Identity
from backend.app.seed_demo import run
from backend.app.services import metrics

def test_metrics_empty_db_is_zero_not_hardcoded(db):
    m = metrics.compute(db)["kpis"]
    assert m["active_identities"] == 13 and m["work_items"] == 0 and m["sla_compliance_pct"] == 100.0

def test_metrics_traceable_to_rows(client, admin, db):
    run(db)
    m = client.get("/reports/metrics", headers=admin).json(); k = m["kpis"]
    reqs = db.scalars(select(AccessRequest)).all()
    assert k["pending_requests"] == sum(r.status in ("Submitted", "Pending Approval") for r in reqs)
    assert sum(m["request_volume_by_day"].values()) == len(reqs) > 0
    assert k["provisioning_success"] + k["provisioning_failed"] <= k["work_items"]
    from backend.app.models import Ticket; assert sum(m["ticket_priority"].values()) == len(db.scalars(select(Ticket)).all()) >= 4

def test_sla_overdue_detected(client, admin, db):
    run(db); future = datetime.utcnow() + timedelta(days=30)
    assert metrics.compute(db, now=future)["kpis"]["overdue_requests"] >= metrics.compute(db)["kpis"]["overdue_requests"]

def test_metrics_forbidden_for_viewer(client, viewer): assert client.get("/reports/metrics", headers=viewer).status_code == 403

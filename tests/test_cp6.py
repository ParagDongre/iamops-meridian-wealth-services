from datetime import datetime, timedelta
from sqlalchemy import select
from backend.app.models import Ticket, WorkItem, TicketEscalation
from backend.app.services import tickets as tk
from .test_cp5 import req, approve
from .test_cp34 import I

def mk(client, h, **kw):
    return client.post("/tickets", json={"ticket_type": "Incident", "description": "VPN broken", "priority": "High"} | kw, headers=h)

def test_sla_deadline_from_priority(client, admin, db):
    t = mk(client, admin).json(); c = db.get(Ticket, t["id"])
    assert abs((c.sla_deadline - c.created_at) - timedelta(hours=8)) < timedelta(seconds=2)

def test_lifecycle_and_rules(client, admin, db):
    i = mk(client, admin).json()["id"]
    assert client.post(f"/tickets/{i}/status", json={"status": "Closed"}, headers=admin).status_code == 409  # illegal jump
    assert client.post(f"/tickets/{i}/status", json={"status": "Resolved"}, headers=admin).status_code == 409  # needs notes
    client.post(f"/tickets/{i}/assign", json={"assignee_id": I(db, "E003").id}, headers=admin)
    client.post(f"/tickets/{i}/comments", json={"body": "looking"}, headers=admin)
    client.post(f"/tickets/{i}/status", json={"status": "Resolved", "notes": "restarted"}, headers=admin)
    assert client.post(f"/tickets/{i}/status", json={"status": "Closed"}, headers=admin).json()["status"] == "Closed"
    assert len(client.get(f"/tickets/{i}", headers=admin).json()["comments"]) == 1

def test_viewer_restrictions(client, viewer):
    assert mk(client, viewer).status_code == 403
    assert mk(client, viewer, ticket_type="Request").status_code == 201
    assert client.get("/tickets", headers=viewer).status_code == 403

def test_breach_and_single_escalation(client, admin, db):
    i = mk(client, admin, priority="Low").json()["id"]; t = db.get(Ticket, i)
    future = t.sla_deadline + timedelta(minutes=1)
    assert tk.is_breached(t, future) and not tk.is_breached(t, t.created_at)
    assert tk.sla_sweep(db, now=future)["escalated_tickets"] == [i]
    assert tk.sla_sweep(db, now=future)["escalated_tickets"] == []  # not escalated twice
    assert t.escalation_level == 2 and len(db.scalars(select(TicketEscalation)).all()) == 1

def test_provisioning_failure_creates_one_linked_ticket(client, admin, db, fake):
    fake.fail = True; rid = req(client, admin, db); approve(client, rid, "Karan Shah", "Lata Desai")
    wi = db.scalar(select(WorkItem)); t = db.get(Ticket, wi.ticket_id)
    assert t.ticket_type == "Incident" and t.related_request_id == rid and t.assignee_id
    client.post(f"/provisioning/work-items/{wi.id}/retry", headers=admin)
    assert len(db.scalars(select(Ticket)).all()) == 1  # retry adds comment, not a new ticket
    assert len(client.get(f"/tickets/{t.id}", headers=admin).json()["comments"]) == 1

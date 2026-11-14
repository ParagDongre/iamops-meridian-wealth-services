from ..models import AuditEvent

def log(db, actor, action, target_id=None, prev=None, new=None, request_id=None,
        ticket_id=None, outcome="Success", previous_state=None, new_state=None):
    """Append-only audit write. Caller commits (same txn as the change)."""
    e = AuditEvent(actor=str(actor), action=action, target_identity_id=target_id,
                   previous_state=previous_state or prev, new_state=new_state or new,
                   related_request_id=request_id, related_ticket_id=ticket_id, outcome=outcome)
    db.add(e)
    return e

from sqlalchemy import event
@event.listens_for(AuditEvent, "before_update")
@event.listens_for(AuditEvent, "before_delete")
def _immutable(*_):
    raise PermissionError("audit_events is append-only")

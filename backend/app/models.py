"""Core schema. Identity != Account != Role != Group != Entitlement (kept separate)."""
from datetime import datetime, date
from sqlalchemy import (String, Integer, Boolean, DateTime, Date, ForeignKey, Text, JSON, UniqueConstraint)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .db import Base

def now(): return datetime.utcnow()

class Identity(Base):  # the person
    __tablename__ = "identities"
    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[str] = mapped_column(String(20), unique=True)
    full_name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(160), unique=True)
    department: Mapped[str] = mapped_column(String(60))
    job_title: Mapped[str] = mapped_column(String(80))
    manager_id: Mapped[int | None] = mapped_column(ForeignKey("identities.id"))
    employment_type: Mapped[str] = mapped_column(String(20), default="Employee")
    location: Mapped[str] = mapped_column(String(60), default="")
    joining_date: Mapped[date] = mapped_column(Date)
    employment_status: Mapped[str] = mapped_column(String(20), default="Active")  # Active/Terminated
    lifecycle_status: Mapped[str] = mapped_column(String(20), default="Active")   # Pending/Active/Disabled
    business_role_id: Mapped[int | None] = mapped_column(ForeignKey("roles.id"))
    app_role: Mapped[str] = mapped_column(String(20), default="viewer")  # platform RBAC: admin/analyst/approver/viewer
    password_hash: Mapped[str | None] = mapped_column(String(200))
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

class Application(Base):
    __tablename__ = "applications"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("identities.id"))
    sensitive: Mapped[bool] = mapped_column(Boolean, default=False)
    sla_hours: Mapped[int] = mapped_column(Integer, default=24)

class Entitlement(Base):  # permission inside an application
    __tablename__ = "entitlements"
    id: Mapped[int] = mapped_column(primary_key=True)
    application_id: Mapped[int] = mapped_column(ForeignKey("applications.id"))
    name: Mapped[str] = mapped_column(String(80))
    sensitive: Mapped[bool] = mapped_column(Boolean, default=False)
    __table_args__ = (UniqueConstraint("application_id", "name"),)

class Role(Base):  # business role
    __tablename__ = "roles"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)

class RoleEntitlement(Base):
    __tablename__ = "role_entitlements"
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"), primary_key=True)
    entitlement_id: Mapped[int] = mapped_column(ForeignKey("entitlements.id"), primary_key=True)

class Group(Base):
    __tablename__ = "groups"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)

class GroupMember(Base):
    __tablename__ = "group_members"
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id"), primary_key=True)
    identity_id: Mapped[int] = mapped_column(ForeignKey("identities.id"), primary_key=True)

class Account(Base):  # identity's account in a target system (keycloak/ldap/app)
    __tablename__ = "accounts"
    id: Mapped[int] = mapped_column(primary_key=True)
    identity_id: Mapped[int] = mapped_column(ForeignKey("identities.id"))
    system: Mapped[str] = mapped_column(String(40))  # keycloak / ldap / <app>
    username: Mapped[str] = mapped_column(String(80))
    external_id: Mapped[str | None] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(20), default="Active")  # Active/Disabled
    __table_args__ = (UniqueConstraint("identity_id", "system"),)  # idempotency guard

class Assignment(Base):  # identity holds entitlement
    __tablename__ = "assignments"
    id: Mapped[int] = mapped_column(primary_key=True)
    identity_id: Mapped[int] = mapped_column(ForeignKey("identities.id"))
    entitlement_id: Mapped[int] = mapped_column(ForeignKey("entitlements.id"))
    source: Mapped[str] = mapped_column(String(20), default="request")  # role/request
    status: Mapped[str] = mapped_column(String(20), default="Active")  # Active/Revoked
    granted_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime)
    __table_args__ = (UniqueConstraint("identity_id", "entitlement_id"),)

class SoDPolicy(Base):
    __tablename__ = "sod_policies"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    entitlement_a_id: Mapped[int] = mapped_column(ForeignKey("entitlements.id"))
    entitlement_b_id: Mapped[int] = mapped_column(ForeignKey("entitlements.id"))
    description: Mapped[str] = mapped_column(Text, default="")

class AccessRequest(Base):
    __tablename__ = "access_requests"
    id: Mapped[int] = mapped_column(primary_key=True)
    requestor_id: Mapped[int] = mapped_column(ForeignKey("identities.id"))
    target_id: Mapped[int] = mapped_column(ForeignKey("identities.id"))
    entitlement_id: Mapped[int] = mapped_column(ForeignKey("entitlements.id"))
    action: Mapped[str] = mapped_column(String(20), default="grant")  # grant/revoke/modify
    justification: Mapped[str] = mapped_column(Text)
    priority: Mapped[str] = mapped_column(String(10), default="Medium")
    status: Mapped[str] = mapped_column(String(20), default="Submitted")
    # Submitted/Pending Approval/Approved/Rejected/Provisioning/Fulfilled/Failed
    rejection_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    sla_deadline: Mapped[datetime] = mapped_column(DateTime)
    fulfilled_at: Mapped[datetime | None] = mapped_column(DateTime)

class Approval(Base):
    __tablename__ = "approvals"
    id: Mapped[int] = mapped_column(primary_key=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("access_requests.id"))
    stage: Mapped[str] = mapped_column(String(20))  # manager/app_owner/compliance
    approver_id: Mapped[int | None] = mapped_column(ForeignKey("identities.id"))
    decision: Mapped[str] = mapped_column(String(20), default="Pending")  # Pending/Approved/Rejected
    comment: Mapped[str | None] = mapped_column(Text)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)

class WorkItem(Base):  # SailPoint-style provisioning work item
    __tablename__ = "work_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    identity_id: Mapped[int] = mapped_column(ForeignKey("identities.id"))
    application_id: Mapped[int | None] = mapped_column(ForeignKey("applications.id"))
    request_id: Mapped[int | None] = mapped_column(ForeignKey("access_requests.id"))
    action: Mapped[str] = mapped_column(String(30))
    priority: Mapped[str] = mapped_column(String(10), default="Medium")
    status: Mapped[str] = mapped_column(String(20), default="Queued")  # Queued/Success/Failed/Escalated
    idempotency_key: Mapped[str] = mapped_column(String(160), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    sla_deadline: Mapped[datetime] = mapped_column(DateTime)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)
    resolution_notes: Mapped[str | None] = mapped_column(Text)
    ticket_id: Mapped[int | None] = mapped_column(ForeignKey("tickets.id"))

class Ticket(Base):  # custom ITSM simulation (NOT ServiceNow)
    __tablename__ = "tickets"
    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_type: Mapped[str] = mapped_column(String(20))  # Incident/Request/Task
    requestor_id: Mapped[int | None] = mapped_column(ForeignKey("identities.id"))
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("identities.id"))
    description: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(40), default="Access")
    priority: Mapped[str] = mapped_column(String(10), default="Medium")
    status: Mapped[str] = mapped_column(String(20), default="New")  # New/Assigned/In Progress/Resolved/Closed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)
    sla_deadline: Mapped[datetime] = mapped_column(DateTime)
    resolution_notes: Mapped[str | None] = mapped_column(Text)
    escalation_level: Mapped[int] = mapped_column(Integer, default=1)
    related_request_id: Mapped[int | None] = mapped_column(Integer)
    related_work_item_id: Mapped[int | None] = mapped_column(Integer)

class TicketComment(Base):
    __tablename__ = "ticket_comments"
    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id"))
    author_id: Mapped[int | None] = mapped_column(ForeignKey("identities.id"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

class Campaign(Base):
    __tablename__ = "cert_campaigns"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    due_date: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

class CertItem(Base):
    __tablename__ = "cert_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("cert_campaigns.id"))
    assignment_id: Mapped[int] = mapped_column(ForeignKey("assignments.id"))
    reviewer_id: Mapped[int] = mapped_column(ForeignKey("identities.id"))
    decision: Mapped[str] = mapped_column(String(20), default="Pending")  # Certified/Revoked/Investigate/Inappropriate
    justification: Mapped[str | None] = mapped_column(Text)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)

class AuditEvent(Base):  # append-only by convention + DB trigger (added in Phase 6)
    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    actor: Mapped[str] = mapped_column(String(80))
    target_identity_id: Mapped[int | None] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(60))
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=now)
    previous_state: Mapped[dict | None] = mapped_column(JSON)
    new_state: Mapped[dict | None] = mapped_column(JSON)
    related_request_id: Mapped[int | None] = mapped_column(Integer)
    related_ticket_id: Mapped[int | None] = mapped_column(Integer)
    outcome: Mapped[str] = mapped_column(String(20), default="Success")

class TicketEscalation(Base):
    __tablename__ = "ticket_escalations"
    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id"))
    from_level: Mapped[int] = mapped_column(Integer)
    to_level: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

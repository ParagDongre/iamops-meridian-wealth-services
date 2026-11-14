import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type DB = DatabaseSync;

export function initDatabase(dbPath: string): DB {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(dbPath);
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS business_roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      department TEXT NOT NULL,
      description TEXT NOT NULL,
      risk_level TEXT NOT NULL DEFAULT 'standard',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE,
      owner_name TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      criticality TEXT NOT NULL DEFAULT 'medium',
      connector_type TEXT NOT NULL DEFAULT 'keycloak_oidc',
      description TEXT NOT NULL,
      sla_hours INTEGER NOT NULL DEFAULT 24,
      simulate_failure INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entitlements (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      sensitivity TEXT NOT NULL DEFAULT 'standard',
      requires_compliance_approval INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_entitlements (
      id TEXT PRIMARY KEY,
      role_id TEXT NOT NULL REFERENCES business_roles(id) ON DELETE CASCADE,
      entitlement_id TEXT NOT NULL REFERENCES entitlements(id) ON DELETE CASCADE,
      UNIQUE(role_id, entitlement_id)
    );

    CREATE TABLE IF NOT EXISTS directory_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      dn TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      application_id TEXT REFERENCES applications(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS identities (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      department TEXT NOT NULL,
      job_title TEXT NOT NULL,
      manager_id TEXT REFERENCES identities(id) ON DELETE SET NULL,
      employment_type TEXT NOT NULL DEFAULT 'Full-Time',
      location TEXT NOT NULL,
      joining_date TEXT NOT NULL,
      employment_status TEXT NOT NULL DEFAULT 'Active',
      lifecycle_status TEXT NOT NULL DEFAULT 'Active',
      business_role_id TEXT REFERENCES business_roles(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS operator_accounts (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      operator_role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      mfa_enabled INTEGER NOT NULL DEFAULT 0,
      mfa_secret TEXT,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS active_sessions (
      jti TEXT PRIMARY KEY,
      operator_id TEXT NOT NULL REFERENCES operator_accounts(id) ON DELETE CASCADE,
      auth_method TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS revoked_tokens (
      jti TEXT PRIMARY KEY,
      operator_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      revoked_by TEXT NOT NULL,
      revoked_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oidc_states (
      state TEXT PRIMARY KEY,
      code_verifier TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS group_memberships (
      id TEXT PRIMARY KEY,
      identity_id TEXT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
      group_id TEXT NOT NULL REFERENCES directory_groups(id) ON DELETE CASCADE,
      assigned_at TEXT NOT NULL,
      UNIQUE(identity_id, group_id)
    );

    CREATE TABLE IF NOT EXISTS app_accounts (
      id TEXT PRIMARY KEY,
      identity_id TEXT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
      application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      external_account_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Active',
      provisioned_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(identity_id, application_id)
    );

    CREATE TABLE IF NOT EXISTS identity_entitlements (
      id TEXT PRIMARY KEY,
      identity_id TEXT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
      entitlement_id TEXT NOT NULL REFERENCES entitlements(id) ON DELETE CASCADE,
      assignment_source TEXT NOT NULL DEFAULT 'role',
      status TEXT NOT NULL DEFAULT 'Active',
      granted_at TEXT NOT NULL,
      revoked_at TEXT,
      UNIQUE(identity_id, entitlement_id)
    );

    CREATE TABLE IF NOT EXISTS sod_policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      entitlement_a_id TEXT NOT NULL REFERENCES entitlements(id) ON DELETE CASCADE,
      entitlement_b_id TEXT NOT NULL REFERENCES entitlements(id) ON DELETE CASCADE,
      severity TEXT NOT NULL DEFAULT 'high',
      enforcement_action TEXT NOT NULL DEFAULT 'block',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sod_violations (
      id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL REFERENCES sod_policies(id) ON DELETE CASCADE,
      identity_id TEXT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'Open',
      detected_at TEXT NOT NULL,
      mitigation_notes TEXT,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS access_requests (
      id TEXT PRIMARY KEY,
      request_number TEXT NOT NULL UNIQUE,
      requestor TEXT NOT NULL,
      target_identity_id TEXT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
      application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      entitlement_id TEXT NOT NULL REFERENCES entitlements(id) ON DELETE CASCADE,
      request_type TEXT NOT NULL DEFAULT 'New Access',
      business_justification TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'medium',
      approval_status TEXT NOT NULL DEFAULT 'Pending Approval',
      current_stage TEXT NOT NULL DEFAULT 'manager',
      assigned_approver TEXT NOT NULL,
      completion_status TEXT NOT NULL DEFAULT 'Open',
      rejection_reason TEXT,
      sla_deadline TEXT NOT NULL,
      is_sla_breached INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS approval_records (
      id TEXT PRIMARY KEY,
      access_request_id TEXT NOT NULL REFERENCES access_requests(id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      approver_name TEXT NOT NULL,
      approver_role TEXT NOT NULL,
      decision TEXT NOT NULL DEFAULT 'Pending',
      comments TEXT,
      decided_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provisioning_work_items (
      id TEXT PRIMARY KEY,
      work_item_number TEXT NOT NULL UNIQUE,
      idempotency_key TEXT NOT NULL UNIQUE,
      identity_id TEXT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
      application_id TEXT REFERENCES applications(id) ON DELETE SET NULL,
      entitlement_id TEXT REFERENCES entitlements(id) ON DELETE SET NULL,
      group_id TEXT REFERENCES directory_groups(id) ON DELETE SET NULL,
      access_request_id TEXT REFERENCES access_requests(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      target_connector TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'Queued',
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      error_details TEXT,
      resolution_notes TEXT,
      escalated_to_l2 INTEGER NOT NULL DEFAULT 0,
      sla_deadline TEXT NOT NULL,
      is_sla_breached INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS idp_accounts (
      id TEXT PRIMARY KEY,
      identity_id TEXT NOT NULL UNIQUE REFERENCES identities(id) ON DELETE CASCADE,
      keycloak_user_id TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE,
      realm TEXT NOT NULL DEFAULT 'meridian',
      enabled INTEGER NOT NULL DEFAULT 1,
      realm_roles TEXT NOT NULL DEFAULT '[]',
      last_synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ldap_entries (
      id TEXT PRIMARY KEY,
      identity_id TEXT NOT NULL UNIQUE REFERENCES identities(id) ON DELETE CASCADE,
      dn TEXT NOT NULL UNIQUE,
      uid TEXT NOT NULL UNIQUE,
      ou TEXT NOT NULL,
      cn TEXT NOT NULL,
      mail TEXT NOT NULL,
      title TEXT NOT NULL,
      member_of TEXT NOT NULL DEFAULT '[]',
      ns_account_lock INTEGER NOT NULL DEFAULT 0,
      last_synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      ticket_number TEXT NOT NULL UNIQUE,
      ticket_type TEXT NOT NULL,
      requestor TEXT NOT NULL,
      assigned_analyst TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'Open',
      linked_request_id TEXT REFERENCES access_requests(id) ON DELETE SET NULL,
      linked_work_item_id TEXT REFERENCES provisioning_work_items(id) ON DELETE SET NULL,
      sla_deadline TEXT NOT NULL,
      is_sla_breached INTEGER NOT NULL DEFAULT 0,
      escalation_level INTEGER NOT NULL DEFAULT 1,
      escalation_history TEXT NOT NULL DEFAULT '[]',
      resolution_notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS ticket_comments (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS certification_campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      scope TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Active',
      due_date TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS certification_items (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES certification_campaigns(id) ON DELETE CASCADE,
      identity_id TEXT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
      application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      entitlement_id TEXT NOT NULL REFERENCES entitlements(id) ON DELETE CASCADE,
      reviewer_name TEXT NOT NULL,
      decision TEXT NOT NULL DEFAULT 'Pending',
      justification TEXT,
      decided_by TEXT,
      decided_at TEXT,
      due_date TEXT NOT NULL,
      is_overdue INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      actor TEXT NOT NULL,
      target_identity TEXT NOT NULL,
      action TEXT NOT NULL,
      category TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      previous_state TEXT,
      new_state TEXT,
      related_id TEXT,
      outcome TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      event_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sla_sweep_runs (
      id TEXT PRIMARY KEY,
      ran_at TEXT NOT NULL,
      triggered_by TEXT NOT NULL,
      breached_requests INTEGER NOT NULL DEFAULT 0,
      breached_work_items INTEGER NOT NULL DEFAULT 0,
      breached_tickets INTEGER NOT NULL DEFAULT 0,
      overdue_certifications INTEGER NOT NULL DEFAULT 0
    );

    CREATE TRIGGER IF NOT EXISTS prevent_audit_update
    BEFORE UPDATE ON audit_events
    BEGIN
      SELECT RAISE(ABORT, 'Audit log is append-only and immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS prevent_audit_delete
    BEFORE DELETE ON audit_events
    BEGIN
      SELECT RAISE(ABORT, 'Audit log is append-only and immutable');
    END;
  `);

  return db;
}

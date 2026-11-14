import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { recordAuditEvent } from './audit.js';
import type { AppConfig } from './config.js';
import type { DB } from './db.js';
import { hashPassword } from './security.js';

export function bootstrapOperators(db: DB, config: AppConfig) {
  const count = (db.prepare('SELECT COUNT(*) AS cnt FROM operator_accounts').get() as { cnt: number }).cnt;
  if (count > 0) return;

  const now = new Date().toISOString();
  const adminPassword =
    process.env.BOOTSTRAP_ADMIN_PASSWORD ||
    (config.env === 'prod' ? crypto.randomBytes(16).toString('hex') : 'MeridianAdmin!2026');

  if (config.env === 'prod' && !process.env.BOOTSTRAP_ADMIN_PASSWORD) {
    console.log(
      JSON.stringify({
        timestamp: now,
        level: 'warn',
        message: 'Created initial production admin account. Set BOOTSTRAP_ADMIN_PASSWORD or reset via CLI.',
        username: 'iam.admin',
      })
    );
  }

  const operators =
    config.env === 'prod'
      ? [
          {
            id: 'OP-ADMIN-01',
            username: 'iam.admin',
            email: 'iam.admin@meridianwealth.internal',
            full_name: 'Elena Vance (IAM Admin)',
            operator_role: 'iam_admin',
            password: adminPassword,
          },
        ]
      : [
          {
            id: 'OP-ADMIN-01',
            username: 'iam.admin',
            email: 'elena.vance@meridianwealth.internal',
            full_name: 'Elena Vance',
            operator_role: 'iam_admin',
            password: adminPassword,
          },
          {
            id: 'OP-ANALYST-01',
            username: 'iam.analyst',
            email: 'marcus.chen@meridianwealth.internal',
            full_name: 'Marcus Chen',
            operator_role: 'iam_analyst',
            password: 'MeridianAnalyst!2026',
          },
          {
            id: 'OP-MGR-01',
            username: 'wealth.manager',
            email: 'claire.bennett@meridianwealth.internal',
            full_name: 'Claire Bennett',
            operator_role: 'manager',
            password: 'MeridianManager!2026',
          },
          {
            id: 'OP-OWNER-01',
            username: 'app.owner',
            email: 'devon.patel@meridianwealth.internal',
            full_name: 'Devon Patel',
            operator_role: 'app_owner',
            password: 'MeridianOwner!2026',
          },
          {
            id: 'OP-AUDIT-01',
            username: 'compliance.auditor',
            email: 'nadia.okafor@meridianwealth.internal',
            full_name: 'Nadia Okafor',
            operator_role: 'auditor',
            password: 'MeridianAuditor!2026',
          },
        ];

  for (const op of operators) {
    db.prepare(
      `INSERT INTO operator_accounts (id, username, email, full_name, operator_role, password_hash, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(op.id, op.username, op.email, op.full_name, op.operator_role, hashPassword(op.password), now);
  }
}

export function readDummyDataFile(): any {
  const filePath = path.resolve(process.cwd(), 'data', 'dummy-data.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function loadMeridianCatalog(db: DB, actor = 'system.bootstrap') {
  const data = readDummyDataFile();
  const now = new Date().toISOString();

  for (const app of data.applications || []) {
    db.prepare(
      `INSERT OR IGNORE INTO applications
        (id, name, code, owner_name, owner_email, criticality, connector_type, description, sla_hours, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      app.id,
      app.name,
      app.code,
      app.owner_name,
      app.owner_email,
      app.criticality,
      app.connector_type,
      app.description,
      app.sla_hours,
      now
    );
  }

  for (const e of data.entitlements || []) {
    db.prepare(
      `INSERT OR IGNORE INTO entitlements
        (id, application_id, name, code, description, sensitivity, requires_compliance_approval, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      e.id,
      e.application_id,
      e.name,
      e.code,
      e.description,
      e.sensitivity,
      e.requires_compliance_approval ? 1 : 0,
      now
    );
  }

  for (const r of data.business_roles || []) {
    db.prepare(
      `INSERT OR IGNORE INTO business_roles (id, name, department, description, risk_level, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(r.id, r.name, r.department, r.description, r.risk_level || 'standard', now);
  }

  for (const [roleId, entId] of data.role_mappings || []) {
    db.prepare(
      `INSERT OR IGNORE INTO role_entitlements (id, role_id, entitlement_id) VALUES (?, ?, ?)`
    ).run(`RE-${roleId}-${entId}`, roleId, entId);
  }

  for (const g of data.directory_groups || []) {
    db.prepare(
      `INSERT OR IGNORE INTO directory_groups (id, name, dn, description, application_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(g.id, g.name, g.dn, g.description, g.application_id || null, now);
  }

  for (const sp of data.sod_policies || []) {
    db.prepare(
      `INSERT OR IGNORE INTO sod_policies
        (id, name, description, entitlement_a_id, entitlement_b_id, severity, enforcement_action, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(
      sp.id,
      sp.name,
      sp.description,
      sp.entitlement_a_id,
      sp.entitlement_b_id,
      sp.severity,
      sp.enforcement_action || 'block',
      now
    );
  }

  recordAuditEvent(db, {
    actor,
    targetIdentity: 'MERIDIAN_CATALOG',
    action: 'Loaded Meridian Wealth Services baseline catalog',
    category: 'catalog',
    outcome: 'Success',
  });
}

export function clearAllOperationalData(db: DB, config: AppConfig) {
  db.exec(`
    DELETE FROM sla_sweep_runs;
    DELETE FROM certification_items;
    DELETE FROM certification_campaigns;
    DELETE FROM ticket_comments;
    DELETE FROM tickets;
    DELETE FROM provisioning_work_items;
    DELETE FROM approval_records;
    DELETE FROM access_requests;
    DELETE FROM sod_violations;
    DELETE FROM sod_policies;
    DELETE FROM identity_entitlements;
    DELETE FROM app_accounts;
    DELETE FROM group_memberships;
    DELETE FROM idp_accounts;
    DELETE FROM ldap_entries;
    DELETE FROM identities;
    DELETE FROM directory_groups;
    DELETE FROM role_entitlements;
    DELETE FROM entitlements;
    DELETE FROM applications;
    DELETE FROM business_roles;
  `);

  if (config.env !== 'prod') {
    db.exec(`
      DROP TRIGGER IF EXISTS prevent_audit_delete;
      DELETE FROM audit_events;
      CREATE TRIGGER IF NOT EXISTS prevent_audit_delete
      BEFORE DELETE ON audit_events
      BEGIN
        SELECT RAISE(ABORT, 'Audit log is append-only and immutable');
      END;
    `);
  }
}

export function loadDummyDataFromFile(
  db: DB,
  config: AppConfig,
  actor = 'system.dummy_loader',
  customData?: any
) {
  bootstrapOperators(db, config);
  const data = customData || readDummyDataFile();

  // Clear existing operational/catalog data cleanly before loading fresh dummy dataset
  clearAllOperationalData(db, config);

  const now = Date.now();
  const isoAgo = (hoursAgo: number) => new Date(now - hoursAgo * 3600_000).toISOString();
  const isoOffset = (hoursOffset: number) => new Date(now + hoursOffset * 3600_000).toISOString();
  const nowIso = new Date(now).toISOString();

  for (const app of data.applications || []) {
    db.prepare(
      `INSERT OR IGNORE INTO applications
        (id, name, code, owner_name, owner_email, criticality, connector_type, description, sla_hours, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      app.id,
      app.name,
      app.code,
      app.owner_name,
      app.owner_email,
      app.criticality,
      app.connector_type,
      app.description,
      app.sla_hours ?? 24,
      nowIso
    );
  }

  for (const e of data.entitlements || []) {
    db.prepare(
      `INSERT OR IGNORE INTO entitlements
        (id, application_id, name, code, description, sensitivity, requires_compliance_approval, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      e.id,
      e.application_id,
      e.name,
      e.code,
      e.description,
      e.sensitivity,
      e.requires_compliance_approval ? 1 : 0,
      nowIso
    );
  }

  for (const r of data.business_roles || []) {
    db.prepare(
      `INSERT OR IGNORE INTO business_roles (id, name, department, description, risk_level, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(r.id, r.name, r.department, r.description, r.risk_level || 'standard', nowIso);
  }

  for (const [roleId, entId] of data.role_mappings || []) {
    db.prepare(
      `INSERT OR IGNORE INTO role_entitlements (id, role_id, entitlement_id) VALUES (?, ?, ?)`
    ).run(`RE-${roleId}-${entId}`, roleId, entId);
  }

  for (const g of data.directory_groups || []) {
    db.prepare(
      `INSERT OR IGNORE INTO directory_groups (id, name, dn, description, application_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(g.id, g.name, g.dn, g.description, g.application_id || null, nowIso);
  }

  for (const sp of data.sod_policies || []) {
    db.prepare(
      `INSERT OR IGNORE INTO sod_policies
        (id, name, description, entitlement_a_id, entitlement_b_id, severity, enforcement_action, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(
      sp.id,
      sp.name,
      sp.description,
      sp.entitlement_a_id,
      sp.entitlement_b_id,
      sp.severity,
      sp.enforcement_action || 'block',
      nowIso
    );
  }

  for (const e of data.identities || []) {
    db.prepare(
      `INSERT INTO identities
        (id, employee_id, full_name, email, department, job_title, manager_id, employment_type,
         location, joining_date, employment_status, lifecycle_status, business_role_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      e.id,
      e.employee_id,
      e.full_name,
      e.email,
      e.department,
      e.job_title,
      e.manager_id || null,
      e.employment_type || 'Full-Time',
      e.location,
      e.joining_date,
      e.employment_status || 'Active',
      e.lifecycle_status || 'Active',
      e.business_role_id || null,
      isoAgo(240),
      isoAgo(12)
    );

    const username = e.email.split('@')[0];
    const ou = e.department.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const isDisabled = e.lifecycle_status === 'Disabled';

    db.prepare(
      `INSERT INTO idp_accounts (id, identity_id, keycloak_user_id, username, realm, enabled, realm_roles, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `IDP-${e.employee_id}`,
      e.id,
      `kc-${e.employee_id.toLowerCase()}`,
      username,
      config.keycloakRealm,
      isDisabled ? 0 : 1,
      isDisabled ? '[]' : JSON.stringify(['meridian-employee', (e.business_role_id || '').toLowerCase()]),
      isoAgo(12)
    );

    db.prepare(
      `INSERT INTO ldap_entries (id, identity_id, dn, uid, ou, cn, mail, title, member_of, ns_account_lock, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `LDAP-${e.employee_id}`,
      e.id,
      `uid=${username},ou=${ou},ou=people,${config.ldapBaseDn}`,
      username,
      ou,
      e.full_name,
      e.email,
      e.job_title,
      '[]',
      isDisabled ? 1 : 0,
      isoAgo(12)
    );

    if (!isDisabled && e.business_role_id) {
      const roleEnts = db
        .prepare(
          `SELECT e.id AS ent_id, e.application_id FROM role_entitlements re
           JOIN entitlements e ON e.id = re.entitlement_id
           WHERE re.role_id = ?`
        )
        .all(e.business_role_id) as Array<{ ent_id: string; application_id: string }>;

      const seenApps = new Set<string>();
      for (const re of roleEnts) {
        if (!seenApps.has(re.application_id)) {
          seenApps.add(re.application_id);
          db.prepare(
            `INSERT OR IGNORE INTO app_accounts (id, identity_id, application_id, username, external_account_id, status, provisioned_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'Active', ?, ?)`
          ).run(
            `ACCT-${e.employee_id}-${re.application_id}`,
            e.id,
            re.application_id,
            username,
            `EXT-${e.employee_id}-${re.application_id.replace('APP-', '')}`,
            isoAgo(180),
            isoAgo(48)
          );
        }
        db.prepare(
          `INSERT OR IGNORE INTO identity_entitlements (id, identity_id, entitlement_id, assignment_source, status, granted_at)
           VALUES (?, ?, ?, 'role', 'Active', ?)`
        ).run(`IE-${e.employee_id}-${re.ent_id}`, e.id, re.ent_id, isoAgo(180));
      }
    }
  }

  for (const [id, grp] of data.group_assignments || []) {
    db.prepare(
      `INSERT OR IGNORE INTO group_memberships (id, identity_id, group_id, assigned_at) VALUES (?, ?, ?, ?)`
    ).run(`GM-${id}-${grp}`, id, grp, isoAgo(160));
  }

  for (const r of data.access_requests || []) {
    const createdAt = isoAgo(r.created_hours_ago ?? 24);
    const slaDeadline = isoOffset(r.sla_hours_offset ?? 12);
    const completedAt =
      r.completed_hours_ago !== null && r.completed_hours_ago !== undefined
        ? isoAgo(r.completed_hours_ago)
        : null;
    db.prepare(
      `INSERT INTO access_requests
        (id, request_number, requestor, target_identity_id, application_id, entitlement_id, request_type,
         business_justification, priority, approval_status, current_stage, assigned_approver, completion_status,
         rejection_reason, sla_deadline, is_sla_breached, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      r.id,
      r.request_number,
      r.requestor,
      r.target_identity_id,
      r.application_id,
      r.entitlement_id,
      r.request_type,
      r.business_justification,
      r.priority,
      r.approval_status,
      r.current_stage,
      r.assigned_approver,
      r.completion_status,
      r.rejection_reason || null,
      slaDeadline,
      r.is_sla_breached ? 1 : 0,
      createdAt,
      createdAt,
      completedAt
    );
  }

  // Approval records matching the dummy requests if present
  if ((data.access_requests || []).some((r: any) => r.id === 'AR-1001')) {
    db.prepare(`INSERT OR IGNORE INTO approval_records (id, access_request_id, stage, approver_name, approver_role, decision, comments, decided_at, created_at) VALUES ('APR-1', 'AR-1001', 'manager', 'Claire Bennett', 'Manager', 'Approved', 'Verified client coverage need', ?, ?)`).run(isoAgo(68), isoAgo(72));
    db.prepare(`INSERT OR IGNORE INTO approval_records (id, access_request_id, stage, approver_name, approver_role, decision, comments, decided_at, created_at) VALUES ('APR-2', 'AR-1001', 'app_owner', 'Claire Bennett', 'Application Owner', 'Approved', 'Approved CRM edit entitlement', ?, ?)`).run(isoAgo(64), isoAgo(72));
  }
  if ((data.access_requests || []).some((r: any) => r.id === 'AR-1002')) {
    db.prepare(`INSERT OR IGNORE INTO approval_records (id, access_request_id, stage, approver_name, approver_role, decision, created_at) VALUES ('APR-3', 'AR-1002', 'manager', 'Claire Bennett', 'Manager', 'Pending', ?)`).run(isoAgo(30));
    db.prepare(`INSERT OR IGNORE INTO approval_records (id, access_request_id, stage, approver_name, approver_role, decision, created_at) VALUES ('APR-4', 'AR-1002', 'app_owner', 'Arthur Pendelton', 'Application Owner', 'Pending', ?)`).run(isoAgo(30));
  }
  if ((data.access_requests || []).some((r: any) => r.id === 'AR-1004')) {
    db.prepare(`INSERT OR IGNORE INTO approval_records (id, access_request_id, stage, approver_name, approver_role, decision, comments, decided_at, created_at) VALUES ('APR-5', 'AR-1004', 'manager', 'Devon Patel', 'Manager', 'Approved', 'Confirmed T+1 audit requirement', ?, ?)`).run(isoAgo(14), isoAgo(20));
    db.prepare(`INSERT OR IGNORE INTO approval_records (id, access_request_id, stage, approver_name, approver_role, decision, comments, decided_at, created_at) VALUES ('APR-6', 'AR-1004', 'app_owner', 'Nadia Okafor', 'Application Owner', 'Approved', 'Approved pending compliance check', ?, ?)`).run(isoAgo(10), isoAgo(20));
    db.prepare(`INSERT OR IGNORE INTO approval_records (id, access_request_id, stage, approver_name, approver_role, decision, created_at) VALUES ('APR-7', 'AR-1004', 'compliance', 'Meridian Compliance Officer', 'Compliance Approver', 'Pending', ?)`).run(isoAgo(20));
  }

  for (const w of data.provisioning_work_items || []) {
    const createdAt = isoAgo(w.created_hours_ago ?? 12);
    const slaDeadline = isoOffset(w.sla_hours_offset ?? 12);
    const completedAt =
      w.completed_hours_ago !== null && w.completed_hours_ago !== undefined
        ? isoAgo(w.completed_hours_ago)
        : null;
    db.prepare(
      `INSERT INTO provisioning_work_items
        (id, work_item_number, idempotency_key, identity_id, application_id, entitlement_id, access_request_id,
         action, target_connector, priority, status, retry_count, max_retries, error_details, resolution_notes,
         escalated_to_l2, sla_deadline, is_sla_breached, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 3, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      w.id,
      w.work_item_number,
      w.idempotency_key,
      w.identity_id,
      w.application_id || null,
      w.entitlement_id || null,
      w.access_request_id || null,
      w.action,
      w.target_connector,
      w.priority,
      w.status,
      w.retry_count ?? 0,
      w.error_details || null,
      w.resolution_notes || null,
      w.escalated_to_l2 ? 1 : 0,
      slaDeadline,
      w.is_sla_breached ? 1 : 0,
      createdAt,
      createdAt,
      completedAt
    );
  }

  for (const t of data.tickets || []) {
    const createdAt = isoAgo(t.created_hours_ago ?? 12);
    const slaDeadline = isoOffset(t.sla_hours_offset ?? 12);
    const resolvedAt =
      t.resolved_hours_ago !== null && t.resolved_hours_ago !== undefined
        ? isoAgo(t.resolved_hours_ago)
        : null;
    db.prepare(
      `INSERT INTO tickets
        (id, ticket_number, ticket_type, requestor, assigned_analyst, title, description, category,
         priority, status, linked_request_id, linked_work_item_id, sla_deadline, is_sla_breached,
         escalation_level, escalation_history, resolution_notes, created_at, updated_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      t.id,
      t.ticket_number,
      t.ticket_type,
      t.requestor,
      t.assigned_analyst,
      t.title,
      t.description,
      t.category,
      t.priority,
      t.status,
      t.linked_request_id || null,
      t.linked_work_item_id || null,
      slaDeadline,
      t.is_sla_breached ? 1 : 0,
      t.escalation_level ?? 1,
      '[]',
      t.resolution_notes || null,
      createdAt,
      createdAt,
      resolvedAt
    );
  }

  for (const c of data.certification_campaigns || []) {
    db.prepare(
      `INSERT INTO certification_campaigns (id, name, description, scope, status, due_date, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      c.id,
      c.name,
      c.description,
      c.scope,
      c.status || 'Active',
      isoOffset(c.due_hours_ahead ?? 96),
      c.created_by,
      isoAgo(c.created_hours_ago ?? 72)
    );
  }

  for (const ci of data.certification_items || []) {
    db.prepare(
      `INSERT INTO certification_items
        (id, campaign_id, identity_id, application_id, entitlement_id, reviewer_name, decision,
         justification, decided_by, decided_at, due_date, is_overdue)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      ci.id,
      ci.campaign_id,
      ci.identity_id,
      ci.application_id,
      ci.entitlement_id,
      ci.reviewer_name,
      ci.decision,
      ci.justification || null,
      ci.decided_by || null,
      ci.decided_hours_ago ? isoAgo(ci.decided_hours_ago) : null,
      isoOffset(ci.due_hours_offset ?? 96),
      ci.is_overdue ? 1 : 0
    );
  }

  recordAuditEvent(db, {
    actor,
    targetIdentity: 'DUMMY_DATASET',
    action: `Loaded test dataset (${(data.identities || []).length} identities, ${(data.applications || []).length} apps, ${(data.access_requests || []).length} requests)`,
    category: 'catalog',
    outcome: 'Success',
  });
}

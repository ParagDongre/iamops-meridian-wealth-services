import crypto from 'node:crypto';
import { recordAuditEvent } from './audit.js';
import type { AppConfig } from './config.js';
import { executeConnectorAction, syncKeycloakIdentity, syncOpenLdapEntry } from './connectors.js';
import type { DB } from './db.js';

export function computeSlaDeadline(priority: string, fromDate = new Date()): string {
  const hoursByPriority: Record<string, number> = {
    critical: 4,
    high: 12,
    medium: 24,
    low: 48,
  };
  const hours = hoursByPriority[priority.toLowerCase()] ?? 24;
  return new Date(fromDate.getTime() + hours * 3600_000).toISOString();
}

function nextSequenceNumber(db: DB, prefix: string, table: string, col: string): string {
  const row = db
    .prepare(`SELECT COUNT(*) AS cnt FROM ${table}`)
    .get() as { cnt: number };
  const num = 1001 + row.cnt;
  const candidate = `${prefix}-${num}`;
  const exists = db.prepare(`SELECT 1 FROM ${table} WHERE ${col} = ?`).get(candidate);
  if (exists) {
    return `${prefix}-${num}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
  }
  return candidate;
}

export interface SodCheckResult {
  allowed: boolean;
  violations: Array<{
    policyId: string;
    policyName: string;
    severity: string;
    enforcementAction: string;
    conflictingEntitlementId: string;
    conflictingEntitlementName: string;
  }>;
}

export function evaluateSodForIdentity(
  db: DB,
  identityId: string,
  candidateEntitlementId: string
): SodCheckResult {
  const activeEnts = db
    .prepare(
      `SELECT entitlement_id FROM identity_entitlements WHERE identity_id = ? AND status = 'Active'`
    )
    .all(identityId) as Array<{ entitlement_id: string }>;
  const activeSet = new Set(activeEnts.map((r) => r.entitlement_id));

  // Also include in-flight approved/pending access requests to stop split-submit bypass
  const pendingEnts = db
    .prepare(
      `SELECT entitlement_id FROM access_requests
       WHERE target_identity_id = ? AND approval_status IN ('Pending Approval', 'Approved') AND completion_status NOT IN ('Completed', 'Closed')`
    )
    .all(identityId) as Array<{ entitlement_id: string }>;
  for (const p of pendingEnts) activeSet.add(p.entitlement_id);

  const policies = db
    .prepare(
      `SELECT sp.*, ea.name AS name_a, eb.name AS name_b
       FROM sod_policies sp
       JOIN entitlements ea ON ea.id = sp.entitlement_a_id
       JOIN entitlements eb ON eb.id = sp.entitlement_b_id
       WHERE sp.is_active = 1 AND (sp.entitlement_a_id = ? OR sp.entitlement_b_id = ?)`
    )
    .all(candidateEntitlementId, candidateEntitlementId) as Array<{
    id: string;
    name: string;
    entitlement_a_id: string;
    entitlement_b_id: string;
    name_a: string;
    name_b: string;
    severity: string;
    enforcement_action: string;
  }>;

  const violations: SodCheckResult['violations'] = [];
  for (const pol of policies) {
    const otherId =
      pol.entitlement_a_id === candidateEntitlementId ? pol.entitlement_b_id : pol.entitlement_a_id;
    const otherName =
      pol.entitlement_a_id === candidateEntitlementId ? pol.name_b : pol.name_a;
    if (activeSet.has(otherId)) {
      violations.push({
        policyId: pol.id,
        policyName: pol.name,
        severity: pol.severity,
        enforcementAction: pol.enforcement_action,
        conflictingEntitlementId: otherId,
        conflictingEntitlementName: otherName,
      });
    }
  }

  const blocked = violations.some((v) => v.enforcementAction === 'block');
  return { allowed: !blocked, violations };
}

export async function createAccessRequest(
  db: DB,
  _config: AppConfig,
  params: {
    requestor: string;
    targetIdentityId: string;
    applicationId: string;
    entitlementId: string;
    requestType?: string;
    businessJustification: string;
    priority?: string;
    actor: string;
  }
) {
  const identity = db
    .prepare(
      `SELECT i.*, m.full_name AS manager_name
       FROM identities i
       LEFT JOIN identities m ON m.id = i.manager_id
       WHERE i.id = ?`
    )
    .get(params.targetIdentityId) as
    | {
        id: string;
        employee_id: string;
        full_name: string;
        email: string;
        lifecycle_status: string;
        employment_status: string;
        manager_name: string | null;
      }
    | undefined;

  if (!identity) {
    return { error: 'Target identity not found', status: 404 as const };
  }

  if (
    (params.requestType || 'New Access') !== 'Access Revocation' &&
    (identity.lifecycle_status === 'Disabled' || identity.employment_status === 'Terminated')
  ) {
    return {
      error: 'Cannot submit new access request for a Terminated or Disabled identity.',
      status: 409 as const,
    };
  }

  const app = db
    .prepare('SELECT * FROM applications WHERE id = ?')
    .get(params.applicationId) as
    | { id: string; name: string; owner_name: string; owner_email: string }
    | undefined;
  const ent = db
    .prepare('SELECT * FROM entitlements WHERE id = ? AND application_id = ?')
    .get(params.entitlementId, params.applicationId) as
    | {
        id: string;
        name: string;
        sensitivity: string;
        requires_compliance_approval: number;
      }
    | undefined;

  if (!app || !ent) {
    return { error: 'Application or entitlement not found', status: 404 as const };
  }

  // Duplicate request detection
  const dup = db
    .prepare(
      `SELECT request_number FROM access_requests
       WHERE target_identity_id = ? AND entitlement_id = ?
         AND approval_status IN ('Submitted', 'Pending Approval', 'Approved')
         AND completion_status IN ('Open', 'Provisioning')`
    )
    .get(params.targetIdentityId, params.entitlementId) as { request_number: string } | undefined;

  if (dup) {
    return {
      error: `Duplicate active access request detected (${dup.request_number}) for this identity and entitlement.`,
      status: 409 as const,
    };
  }

  // SoD policy enforcement (skip if revoking access)
  const isRevocation = params.requestType === 'Access Revocation';
  if (!isRevocation) {
    const sod = evaluateSodForIdentity(db, params.targetIdentityId, params.entitlementId);
    if (sod.violations.length > 0) {
      const now = new Date().toISOString();
      for (const v of sod.violations) {
        db.prepare(
          `INSERT INTO sod_violations (id, policy_id, identity_id, status, detected_at, mitigation_notes)
           VALUES (?, ?, ?, 'Open', ?, ?)`
        ).run(
          `SODV-${crypto.randomUUID().slice(0, 8)}`,
          v.policyId,
          params.targetIdentityId,
          now,
          `Detected on request for ${ent.name} (conflicts with ${v.conflictingEntitlementName})`
        );
      }
      if (!sod.allowed) {
        recordAuditEvent(db, {
          actor: params.actor,
          targetIdentity: identity.email,
          action: `SoD Policy Blocked Access Request: ${ent.name}`,
          category: 'rbac_sod',
          newState: { violations: sod.violations },
          outcome: 'Blocked',
        });
        return {
          error: `Segregation of Duties (SoD) conflict blocked request: ${sod.violations.map((v) => `${v.policyName} (conflicts with ${v.conflictingEntitlementName})`).join('; ')}`,
          status: 409 as const,
          sodViolations: sod.violations,
        };
      }
    }
  }

  const now = new Date().toISOString();
  const priority = (params.priority || 'medium').toLowerCase();
  const slaDeadline = computeSlaDeadline(priority);
  const requestId = `AR-${crypto.randomUUID().slice(0, 8)}`;
  const requestNumber = nextSequenceNumber(db, 'REQ', 'access_requests', 'request_number');
  const managerApprover = identity.manager_name || 'Department Manager';

  db.prepare(
    `INSERT INTO access_requests
      (id, request_number, requestor, target_identity_id, application_id, entitlement_id, request_type,
       business_justification, priority, approval_status, current_stage, assigned_approver, completion_status,
       sla_deadline, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending Approval', 'manager', ?, 'Open', ?, ?, ?)`
  ).run(
    requestId,
    requestNumber,
    params.requestor,
    params.targetIdentityId,
    params.applicationId,
    params.entitlementId,
    params.requestType || 'New Access',
    params.businessJustification,
    priority,
    managerApprover,
    slaDeadline,
    now,
    now
  );

  // Create sequential approval stages
  const stages: Array<{ stage: string; name: string; role: string }> = [
    { stage: 'manager', name: managerApprover, role: 'Manager' },
    { stage: 'app_owner', name: app.owner_name, role: 'Application Owner' },
  ];
  if (ent.requires_compliance_approval === 1 || ent.sensitivity === 'critical') {
    stages.push({
      stage: 'compliance',
      name: 'Meridian Compliance Officer',
      role: 'Compliance Approver',
    });
  }

  for (const s of stages) {
    db.prepare(
      `INSERT INTO approval_records (id, access_request_id, stage, approver_name, approver_role, decision, created_at)
       VALUES (?, ?, ?, ?, ?, 'Pending', ?)`
    ).run(`APR-${crypto.randomUUID().slice(0, 8)}`, requestId, s.stage, s.name, s.role, now);
  }

  recordAuditEvent(db, {
    actor: params.actor,
    targetIdentity: identity.email,
    action: `Access Request Submitted (${requestNumber}): ${app.name} — ${ent.name}`,
    category: 'access_request',
    newState: { requestNumber, priority, stages: stages.map((s) => s.stage) },
    relatedId: requestNumber,
    outcome: 'Success',
  });

  return {
    status: 201 as const,
    request: db.prepare('SELECT * FROM access_requests WHERE id = ?').get(requestId),
  };
}

export async function processWorkItem(
  db: DB,
  config: AppConfig,
  workItemId: string,
  actor: string
) {
  const item = db
    .prepare('SELECT * FROM provisioning_work_items WHERE id = ?')
    .get(workItemId) as
    | {
        id: string;
        work_item_number: string;
        idempotency_key: string;
        identity_id: string;
        application_id: string | null;
        entitlement_id: string | null;
        group_id: string | null;
        access_request_id: string | null;
        action: string;
        target_connector: string;
        priority: string;
        status: string;
        retry_count: number;
        max_retries: number;
        escalated_to_l2: number;
      }
    | undefined;

  if (!item) return { error: 'Work item not found', status: 404 as const };

  // Idempotency: never re-run already fulfilled work items
  if (item.status === 'Fulfilled') {
    return {
      status: 200 as const,
      idempotentSkip: true,
      workItem: item,
    };
  }

  const identity = db
    .prepare('SELECT email FROM identities WHERE id = ?')
    .get(item.identity_id) as { email: string } | undefined;

  const now = new Date().toISOString();
  const result = await executeConnectorAction(db, config, item);

  if (result.success) {
    db.prepare(
      `UPDATE provisioning_work_items
       SET status = 'Fulfilled', error_details = NULL, resolution_notes = ?, updated_at = ?, completed_at = ?
       WHERE id = ?`
    ).run(
      `Provisioned via ${result.targetSystem} (${result.externalReference || 'OK'})`,
      now,
      now,
      item.id
    );

    if (item.access_request_id) {
      const pendingOrFailed = db
        .prepare(
          `SELECT COUNT(*) AS cnt FROM provisioning_work_items
           WHERE access_request_id = ? AND status != 'Fulfilled'`
        )
        .get(item.access_request_id) as { cnt: number };

      if (pendingOrFailed.cnt === 0) {
        db.prepare(
          `UPDATE access_requests
           SET completion_status = 'Fulfilled', updated_at = ?, completed_at = ?
           WHERE id = ?`
        ).run(now, now, item.access_request_id);
      }
    }

    recordAuditEvent(db, {
      actor,
      targetIdentity: identity?.email || item.identity_id,
      action: `Provisioning Fulfilled (${item.work_item_number}): ${item.action}`,
      category: 'provisioning',
      newState: {
        workItemNumber: item.work_item_number,
        connector: result.targetSystem,
        externalReference: result.externalReference,
      },
      relatedId: item.work_item_number,
      outcome: 'Success',
    });

    return {
      status: 200 as const,
      idempotentSkip: false,
      workItem: db.prepare('SELECT * FROM provisioning_work_items WHERE id = ?').get(item.id),
    };
  }

  // Provisioning failed: increment retry_count, never silently succeed
  const nextRetry = item.retry_count + 1;
  const shouldEscalate = nextRetry >= item.max_retries ? 1 : item.escalated_to_l2;
  db.prepare(
    `UPDATE provisioning_work_items
     SET status = 'Failed', retry_count = ?, error_details = ?, escalated_to_l2 = ?, updated_at = ?
     WHERE id = ?`
  ).run(nextRetry, result.error || 'Unknown downstream connector error', shouldEscalate, now, item.id);

  if (item.access_request_id) {
    db.prepare(
      `UPDATE access_requests SET completion_status = 'Failed', updated_at = ? WHERE id = ?`
    ).run(now, item.access_request_id);
  }

  // Auto-create linked ITSM Incident if none exists yet for this failed work item
  const existingTicket = db
    .prepare(`SELECT id, ticket_number FROM tickets WHERE linked_work_item_id = ? AND status != 'Closed'`)
    .get(item.id) as { id: string; ticket_number: string } | undefined;

  let incidentNumber = existingTicket?.ticket_number;
  if (!existingTicket) {
    incidentNumber = nextSequenceNumber(db, 'INC', 'tickets', 'ticket_number');
    const ticketId = `TKT-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO tickets
        (id, ticket_number, ticket_type, requestor, assigned_analyst, title, description, category, priority, status,
         linked_request_id, linked_work_item_id, sla_deadline, escalation_level, escalation_history, created_at, updated_at)
       VALUES (?, ?, 'Incident', 'Provisioning Engine', 'IAM L2 Analyst', ?, ?, 'Provisioning Failure', 'high', 'Open',
               ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      ticketId,
      incidentNumber,
      `Provisioning failure on ${item.work_item_number} (${item.action})`,
      `Automated Incident raised by Provisioning Orchestration Engine.\nError: ${result.error}`,
      item.access_request_id,
      item.id,
      computeSlaDeadline('high'),
      shouldEscalate ? 2 : 1,
      JSON.stringify(
        shouldEscalate
          ? [{ at: now, level: 2, reason: 'Max retries reached — auto-escalated to L2' }]
          : []
      ),
      now,
      now
    );
  }

  recordAuditEvent(db, {
    actor,
    targetIdentity: identity?.email || item.identity_id,
    action: `Provisioning Failed (${item.work_item_number}): ${result.error}`,
    category: 'provisioning',
    newState: {
      workItemNumber: item.work_item_number,
      retryCount: nextRetry,
      escalatedToL2: Boolean(shouldEscalate),
      linkedIncident: incidentNumber,
    },
    relatedId: item.work_item_number,
    outcome: 'Failure',
  });

  return {
    status: 200 as const,
    idempotentSkip: false,
    failed: true,
    error: result.error,
    linkedIncident: incidentNumber,
    workItem: db.prepare('SELECT * FROM provisioning_work_items WHERE id = ?').get(item.id),
  };
}

export async function decideAccessRequestStage(
  db: DB,
  config: AppConfig,
  requestId: string,
  decision: 'Approved' | 'Rejected',
  comments: string,
  actorName: string
) {
  const reqRow = db
    .prepare(
      `SELECT ar.*, i.email AS target_email, a.name AS app_name, e.name AS ent_name
       FROM access_requests ar
       JOIN identities i ON i.id = ar.target_identity_id
       JOIN applications a ON a.id = ar.application_id
       JOIN entitlements e ON e.id = ar.entitlement_id
       WHERE ar.id = ?`
    )
    .get(requestId) as
    | {
        id: string;
        request_number: string;
        target_identity_id: string;
        application_id: string;
        entitlement_id: string;
        request_type: string;
        priority: string;
        approval_status: string;
        current_stage: string;
        target_email: string;
        app_name: string;
        ent_name: string;
      }
    | undefined;

  if (!reqRow) return { error: 'Access request not found', status: 404 as const };
  if (reqRow.approval_status !== 'Pending Approval') {
    return {
      error: `Request ${reqRow.request_number} is already ${reqRow.approval_status}`,
      status: 409 as const,
    };
  }

  const now = new Date().toISOString();
  const currentApproval = db
    .prepare(
      `SELECT * FROM approval_records
       WHERE access_request_id = ? AND stage = ? AND decision = 'Pending'`
    )
    .get(requestId, reqRow.current_stage) as
    | { id: string; stage: string; approver_name: string }
    | undefined;

  if (!currentApproval) {
    return { error: 'No pending approval stage found', status: 409 as const };
  }

  if (decision === 'Rejected') {
    if (!comments || !comments.trim()) {
      return { error: 'Rejection reason is required.', status: 400 as const };
    }
    db.prepare(
      `UPDATE approval_records SET decision = 'Rejected', comments = ?, decided_at = ?, approver_name = ? WHERE id = ?`
    ).run(comments.trim(), now, actorName, currentApproval.id);
    db.prepare(
      `UPDATE approval_records SET decision = 'Skipped' WHERE access_request_id = ? AND decision = 'Pending'`
    ).run(requestId);
    db.prepare(
      `UPDATE access_requests
       SET approval_status = 'Rejected', completion_status = 'Closed', rejection_reason = ?, updated_at = ?, completed_at = ?
       WHERE id = ?`
    ).run(comments.trim(), now, now, requestId);

    recordAuditEvent(db, {
      actor: actorName,
      targetIdentity: reqRow.target_email,
      action: `Access Request Rejected at ${reqRow.current_stage} stage (${reqRow.request_number})`,
      category: 'approval',
      newState: { reason: comments.trim(), stage: reqRow.current_stage },
      relatedId: reqRow.request_number,
      outcome: 'Success',
    });

    return {
      status: 200 as const,
      request: db.prepare('SELECT * FROM access_requests WHERE id = ?').get(requestId),
    };
  }

  // Approved current stage
  db.prepare(
    `UPDATE approval_records SET decision = 'Approved', comments = ?, decided_at = ?, approver_name = ? WHERE id = ?`
  ).run(comments || 'Approved', now, actorName, currentApproval.id);

  recordAuditEvent(db, {
    actor: actorName,
    targetIdentity: reqRow.target_email,
    action: `Approval Stage Passed (${reqRow.current_stage}) for ${reqRow.request_number}`,
    category: 'approval',
    newState: { stage: reqRow.current_stage, decision: 'Approved' },
    relatedId: reqRow.request_number,
    outcome: 'Success',
  });

  // Check if another stage remains pending
  const nextStage = db
    .prepare(
      `SELECT * FROM approval_records WHERE access_request_id = ? AND decision = 'Pending' ORDER BY rowid ASC LIMIT 1`
    )
    .get(requestId) as { id: string; stage: string; approver_name: string } | undefined;

  if (nextStage) {
    db.prepare(
      `UPDATE access_requests SET current_stage = ?, assigned_approver = ?, updated_at = ? WHERE id = ?`
    ).run(nextStage.stage, nextStage.approver_name, now, requestId);

    return {
      status: 200 as const,
      request: db.prepare('SELECT * FROM access_requests WHERE id = ?').get(requestId),
    };
  }

  // All approval stages completed -> check SoD one final time before provisioning
  const actionType =
    reqRow.request_type === 'Access Revocation' ? 'revoke_entitlement' : 'grant_entitlement';

  if (actionType === 'grant_entitlement') {
    const sod = evaluateSodForIdentity(db, reqRow.target_identity_id, reqRow.entitlement_id);
    if (!sod.allowed) {
      db.prepare(
        `UPDATE access_requests
         SET approval_status = 'Rejected', completion_status = 'Closed',
             rejection_reason = ?, updated_at = ?, completed_at = ?
         WHERE id = ?`
      ).run(
        `Blocked post-approval by SoD policy: ${sod.violations.map((v) => v.policyName).join(', ')}`,
        now,
        now,
        requestId
      );
      return {
        error: `Final SoD guard blocked provisioning: ${sod.violations.map((v) => v.policyName).join(', ')}`,
        status: 409 as const,
      };
    }
  }

  db.prepare(
    `UPDATE access_requests
     SET approval_status = 'Approved', completion_status = 'Provisioning', updated_at = ?
     WHERE id = ?`
  ).run(now, requestId);

  const wiId = `WI-${crypto.randomUUID().slice(0, 8)}`;
  const wiNum = nextSequenceNumber(db, 'WI', 'provisioning_work_items', 'work_item_number');
  const idempotencyKey = `${reqRow.request_number}:${actionType}:${reqRow.target_identity_id}:${reqRow.entitlement_id}`;

  db.prepare(
    `INSERT OR IGNORE INTO provisioning_work_items
      (id, work_item_number, idempotency_key, identity_id, application_id, entitlement_id, access_request_id,
       action, target_connector, priority, status, sla_deadline, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Keycloak IdP + App Adapter', ?, 'Queued', ?, ?, ?)`
  ).run(
    wiId,
    wiNum,
    idempotencyKey,
    reqRow.target_identity_id,
    reqRow.application_id,
    reqRow.entitlement_id,
    requestId,
    actionType,
    reqRow.priority,
    computeSlaDeadline(reqRow.priority),
    now,
    now
  );

  await processWorkItem(db, config, wiId, 'Provisioning Engine');

  return {
    status: 200 as const,
    request: db.prepare('SELECT * FROM access_requests WHERE id = ?').get(requestId),
    workItem: db.prepare('SELECT * FROM provisioning_work_items WHERE id = ?').get(wiId),
  };
}

export async function runJoinerWorkflow(
  db: DB,
  config: AppConfig,
  payload: {
    fullName: string;
    email: string;
    department: string;
    jobTitle: string;
    managerId?: string | null;
    employmentType: string;
    location: string;
    joiningDate: string;
    businessRoleId: string;
    autoApproveStandard?: boolean;
  },
  actor: string
) {
  const existing = db
    .prepare('SELECT id FROM identities WHERE email = ?')
    .get(payload.email.toLowerCase());
  if (existing) {
    return { error: `Identity with email ${payload.email} already exists`, status: 409 as const };
  }

  const role = db
    .prepare('SELECT * FROM business_roles WHERE id = ?')
    .get(payload.businessRoleId) as { id: string; name: string } | undefined;
  if (!role) return { error: 'Business role not found', status: 404 as const };

  const now = new Date().toISOString();
  const id = `ID-${crypto.randomUUID().slice(0, 8)}`;
  const empId = nextSequenceNumber(db, 'EMP', 'identities', 'employee_id');

  db.prepare(
    `INSERT INTO identities
      (id, employee_id, full_name, email, department, job_title, manager_id, employment_type,
       location, joining_date, employment_status, lifecycle_status, business_role_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', 'Active', ?, ?, ?)`
  ).run(
    id,
    empId,
    payload.fullName,
    payload.email.toLowerCase(),
    payload.department,
    payload.jobTitle,
    payload.managerId || null,
    payload.employmentType,
    payload.location,
    payload.joiningDate,
    payload.businessRoleId,
    now,
    now
  );

  // Sync baseline Keycloak IdP & OpenLDAP entry
  await syncKeycloakIdentity(db, config, id, 'upsert');
  syncOpenLdapEntry(db, config, id, 'upsert');

  recordAuditEvent(db, {
    actor,
    targetIdentity: payload.email.toLowerCase(),
    action: `Joiner Workflow Initiated (${empId}): ${payload.fullName} assigned role ${role.name}`,
    category: 'jml',
    newState: { employeeId: empId, role: role.name, department: payload.department },
    relatedId: empId,
    outcome: 'Success',
  });

  // Determine required role entitlements & generate access requests
  const roleEnts = db
    .prepare(
      `SELECT e.* FROM role_entitlements re
       JOIN entitlements e ON e.id = re.entitlement_id
       WHERE re.role_id = ?`
    )
    .all(payload.businessRoleId) as Array<{
    id: string;
    application_id: string;
    name: string;
    sensitivity: string;
    requires_compliance_approval: number;
  }>;

  const generatedRequests: unknown[] = [];
  for (const ent of roleEnts) {
    const res = await createAccessRequest(db, config, {
      requestor: actor,
      targetIdentityId: id,
      applicationId: ent.application_id,
      entitlementId: ent.id,
      requestType: 'Joiner Birthright Access',
      businessJustification: `Joiner onboarding for ${payload.fullName} (${role.name})`,
      priority: 'high',
      actor,
    });
    if ('request' in res && res.request) {
      const reqObj = res.request as { id: string };
      // If autoApproveStandard is explicitly enabled and entitlement is standard, advance approvals
      if (
        payload.autoApproveStandard &&
        ent.sensitivity === 'standard' &&
        ent.requires_compliance_approval === 0
      ) {
        await decideAccessRequestStage(db, config, reqObj.id, 'Approved', 'Joiner baseline auto-approved by policy', actor);
        await decideAccessRequestStage(db, config, reqObj.id, 'Approved', 'Joiner baseline auto-approved by app owner policy', actor);
      }
      generatedRequests.push(
        db.prepare('SELECT * FROM access_requests WHERE id = ?').get(reqObj.id)
      );
    }
  }

  return {
    status: 201 as const,
    identity: db.prepare('SELECT * FROM identities WHERE id = ?').get(id),
    generatedRequests,
  };
}

export async function runMoverWorkflow(
  db: DB,
  config: AppConfig,
  payload: {
    identityId: string;
    newDepartment: string;
    newJobTitle: string;
    newManagerId?: string | null;
    newBusinessRoleId: string;
    justification: string;
  },
  actor: string
) {
  const identity = db
    .prepare('SELECT * FROM identities WHERE id = ?')
    .get(payload.identityId) as
    | {
        id: string;
        employee_id: string;
        email: string;
        department: string;
        job_title: string;
        manager_id: string | null;
        business_role_id: string | null;
        lifecycle_status: string;
      }
    | undefined;

  if (!identity) return { error: 'Identity not found', status: 404 as const };
  if (identity.lifecycle_status === 'Disabled') {
    return { error: 'Cannot run Mover workflow on a Disabled identity', status: 409 as const };
  }

  const newRole = db
    .prepare('SELECT * FROM business_roles WHERE id = ?')
    .get(payload.newBusinessRoleId) as { id: string; name: string } | undefined;
  if (!newRole) return { error: 'Target business role not found', status: 404 as const };

  const now = new Date().toISOString();
  const prevState = {
    department: identity.department,
    job_title: identity.job_title,
    manager_id: identity.manager_id,
    business_role_id: identity.business_role_id,
  };

  db.prepare(
    `UPDATE identities
     SET department = ?, job_title = ?, manager_id = ?, business_role_id = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    payload.newDepartment,
    payload.newJobTitle,
    payload.newManagerId ?? identity.manager_id,
    payload.newBusinessRoleId,
    now,
    payload.identityId
  );

  // Recalculate role entitlements
  const targetRoleEnts = db
    .prepare(
      `SELECT e.id, e.application_id, e.name FROM role_entitlements re
       JOIN entitlements e ON e.id = re.entitlement_id
       WHERE re.role_id = ?`
    )
    .all(payload.newBusinessRoleId) as Array<{ id: string; application_id: string; name: string }>;
  const targetEntSet = new Set(targetRoleEnts.map((e) => e.id));

  const currentActiveEnts = db
    .prepare(
      `SELECT ie.entitlement_id, e.application_id, e.name
       FROM identity_entitlements ie
       JOIN entitlements e ON e.id = ie.entitlement_id
       WHERE ie.identity_id = ? AND ie.status = 'Active'`
    )
    .all(payload.identityId) as Array<{ entitlement_id: string; application_id: string; name: string }>;
  const currentEntSet = new Set(currentActiveEnts.map((e) => e.entitlement_id));

  const revokedWorkItems: unknown[] = [];
  for (const cur of currentActiveEnts) {
    if (!targetEntSet.has(cur.entitlement_id)) {
      const wiId = `WI-${crypto.randomUUID().slice(0, 8)}`;
      const wiNum = nextSequenceNumber(db, 'WI', 'provisioning_work_items', 'work_item_number');
      db.prepare(
        `INSERT INTO provisioning_work_items
          (id, work_item_number, idempotency_key, identity_id, application_id, entitlement_id,
           action, target_connector, priority, status, sla_deadline, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'revoke_entitlement', 'Keycloak IdP + App Adapter', 'high', 'Queued', ?, ?, ?)`
      ).run(
        wiId,
        wiNum,
        `MOVER-REVOKE:${payload.identityId}:${cur.entitlement_id}:${Date.now()}`,
        payload.identityId,
        cur.application_id,
        cur.entitlement_id,
        computeSlaDeadline('high'),
        now,
        now
      );
      await processWorkItem(db, config, wiId, 'JML Mover Engine');
      revokedWorkItems.push(db.prepare('SELECT * FROM provisioning_work_items WHERE id = ?').get(wiId));
    }
  }

  const newAccessRequests: unknown[] = [];
  for (const target of targetRoleEnts) {
    if (!currentEntSet.has(target.id)) {
      const res = await createAccessRequest(db, config, {
        requestor: actor,
        targetIdentityId: payload.identityId,
        applicationId: target.application_id,
        entitlementId: target.id,
        requestType: 'Role Change',
        businessJustification: `Mover role transition to ${newRole.name}: ${payload.justification}`,
        priority: 'high',
        actor,
      });
      if ('request' in res && res.request) {
        newAccessRequests.push(res.request);
      }
    }
  }

  await syncKeycloakIdentity(db, config, payload.identityId, 'upsert');
  syncOpenLdapEntry(db, config, payload.identityId, 'upsert');

  recordAuditEvent(db, {
    actor,
    targetIdentity: identity.email,
    action: `Mover Workflow Completed (${identity.employee_id}): Role -> ${newRole.name}`,
    category: 'jml',
    previousState: prevState,
    newState: {
      department: payload.newDepartment,
      job_title: payload.newJobTitle,
      business_role: newRole.name,
      revokedEntitlementsCount: revokedWorkItems.length,
      newRequestsCount: newAccessRequests.length,
    },
    relatedId: identity.employee_id,
    outcome: 'Success',
  });

  return {
    status: 200 as const,
    identity: db.prepare('SELECT * FROM identities WHERE id = ?').get(payload.identityId),
    revokedWorkItems,
    newAccessRequests,
  };
}

export async function runLeaverWorkflow(
  db: DB,
  config: AppConfig,
  payload: {
    identityId: string;
    terminationReason: string;
  },
  actor: string
) {
  const identity = db
    .prepare('SELECT * FROM identities WHERE id = ?')
    .get(payload.identityId) as
    | {
        id: string;
        employee_id: string;
        email: string;
        employment_status: string;
        lifecycle_status: string;
      }
    | undefined;

  if (!identity) return { error: 'Identity not found', status: 404 as const };

  const now = new Date().toISOString();
  const prevState = {
    employment_status: identity.employment_status,
    lifecycle_status: identity.lifecycle_status,
  };

  db.prepare(
    `UPDATE identities
     SET employment_status = 'Terminated', lifecycle_status = 'Disabled', updated_at = ?
     WHERE id = ?`
  ).run(now, payload.identityId);

  // Cancel any open pending access requests so they can never be approved post-termination
  db.prepare(
    `UPDATE access_requests
     SET approval_status = 'Rejected', completion_status = 'Closed',
         rejection_reason = 'Auto-cancelled by Leaver termination safeguard', updated_at = ?, completed_at = ?
     WHERE target_identity_id = ? AND approval_status IN ('Submitted', 'Pending Approval')`
  ).run(now, now, payload.identityId);

  const wiId = `WI-${crypto.randomUUID().slice(0, 8)}`;
  const wiNum = nextSequenceNumber(db, 'WI', 'provisioning_work_items', 'work_item_number');

  db.prepare(
    `INSERT INTO provisioning_work_items
      (id, work_item_number, idempotency_key, identity_id, action, target_connector, priority, status, sla_deadline, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'disable_account', 'Keycloak IdP + OpenLDAP + All Apps', 'critical', 'Queued', ?, ?, ?)`
  ).run(
    wiId,
    wiNum,
    `LEAVER-DISABLE:${payload.identityId}:${now}`,
    payload.identityId,
    computeSlaDeadline('critical'),
    now,
    now
  );

  await processWorkItem(db, config, wiId, 'JML Leaver Safeguard');

  // Verify zero privilege retention safeguard
  const remainingEnts = db
    .prepare(`SELECT COUNT(*) AS cnt FROM identity_entitlements WHERE identity_id = ? AND status = 'Active'`)
    .get(payload.identityId) as { cnt: number };
  const remainingAccts = db
    .prepare(`SELECT COUNT(*) AS cnt FROM app_accounts WHERE identity_id = ? AND status = 'Active'`)
    .get(payload.identityId) as { cnt: number };
  const remainingGroups = db
    .prepare(`SELECT COUNT(*) AS cnt FROM group_memberships WHERE identity_id = ?`)
    .get(payload.identityId) as { cnt: number };

  const verifiedZeroAccess =
    remainingEnts.cnt === 0 && remainingAccts.cnt === 0 && remainingGroups.cnt === 0;

  recordAuditEvent(db, {
    actor,
    targetIdentity: identity.email,
    action: `Leaver Workflow Executed (${identity.employee_id}): All access & IdP/LDAP accounts disabled`,
    category: 'jml',
    previousState: prevState,
    newState: {
      employment_status: 'Terminated',
      lifecycle_status: 'Disabled',
      reason: payload.terminationReason,
      verifiedZeroAccess,
    },
    relatedId: wiNum,
    outcome: verifiedZeroAccess ? 'Success' : 'Failure',
  });

  return {
    status: 200 as const,
    identity: db.prepare('SELECT * FROM identities WHERE id = ?').get(payload.identityId),
    workItem: db.prepare('SELECT * FROM provisioning_work_items WHERE id = ?').get(wiId),
    verification: {
      verifiedZeroAccess,
      remainingActiveEntitlements: remainingEnts.cnt,
      remainingActiveAccounts: remainingAccts.cnt,
      remainingGroupMemberships: remainingGroups.cnt,
    },
  };
}

export function runSlaSweep(db: DB, triggeredBy: string) {
  const now = new Date().toISOString();

  const reqBreach = db
    .prepare(
      `UPDATE access_requests SET is_sla_breached = 1, updated_at = ?
       WHERE completion_status IN ('Open', 'Provisioning') AND sla_deadline < ? AND is_sla_breached = 0`
    )
    .run(now, now);

  const wiBreach = db
    .prepare(
      `UPDATE provisioning_work_items SET is_sla_breached = 1, escalated_to_l2 = 1, updated_at = ?
       WHERE status IN ('Queued', 'Failed') AND sla_deadline < ? AND is_sla_breached = 0`
    )
    .run(now, now);

  const tktBreach = db
    .prepare(
      `UPDATE tickets SET is_sla_breached = 1, escalation_level = CASE WHEN escalation_level < 2 THEN 2 ELSE escalation_level END, updated_at = ?
       WHERE status IN ('Open', 'In Progress', 'Escalated') AND sla_deadline < ? AND is_sla_breached = 0`
    )
    .run(now, now);

  const certBreach = db
    .prepare(
      `UPDATE certification_items SET is_overdue = 1
       WHERE decision = 'Pending' AND due_date < ? AND is_overdue = 0`
    )
    .run(now);

  const runId = `SWP-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO sla_sweep_runs (id, ran_at, triggered_by, breached_requests, breached_work_items, breached_tickets, overdue_certifications)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    runId,
    now,
    triggeredBy,
    Number(reqBreach.changes),
    Number(wiBreach.changes),
    Number(tktBreach.changes),
    Number(certBreach.changes)
  );

  const totalNew =
    Number(reqBreach.changes) +
    Number(wiBreach.changes) +
    Number(tktBreach.changes) +
    Number(certBreach.changes);

  if (totalNew > 0) {
    recordAuditEvent(db, {
      actor: triggeredBy,
      targetIdentity: 'SYSTEM_SLA_MONITOR',
      action: `SLA Breach Sweep flagged ${totalNew} overdue operational items`,
      category: 'sla',
      newState: {
        breachedRequests: reqBreach.changes,
        breachedWorkItems: wiBreach.changes,
        breachedTickets: tktBreach.changes,
        overdueCertifications: certBreach.changes,
      },
      relatedId: runId,
      outcome: 'Warning',
    });
  }

  return {
    runId,
    ranAt: now,
    breachedRequests: Number(reqBreach.changes),
    breachedWorkItems: Number(wiBreach.changes),
    breachedTickets: Number(tktBreach.changes),
    overdueCertifications: Number(certBreach.changes),
  };
}

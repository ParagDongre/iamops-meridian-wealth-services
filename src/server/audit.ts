import crypto from 'node:crypto';
import type { DB } from './db.js';

export interface AuditInput {
  actor: string;
  targetIdentity: string;
  action: string;
  category:
    | 'identity'
    | 'jml'
    | 'access_request'
    | 'approval'
    | 'provisioning'
    | 'rbac_sod'
    | 'ticket'
    | 'certification'
    | 'security'
    | 'catalog'
    | 'sla';
  previousState?: unknown;
  newState?: unknown;
  relatedId?: string;
  outcome: 'Success' | 'Failure' | 'Blocked' | 'Warning';
  timestamp?: string;
}

export function recordAuditEvent(db: DB, input: AuditInput): { id: string; eventHash: string } {
  const id = `AUD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const timestamp = input.timestamp || new Date().toISOString();
  const prevRow = db
    .prepare('SELECT event_hash FROM audit_events ORDER BY seq DESC LIMIT 1')
    .get() as { event_hash: string } | undefined;
  const prevHash = prevRow?.event_hash || 'GENESIS_MERIDIAN_IAMOPS_V1';

  const prevStateStr =
    input.previousState === undefined ? null : JSON.stringify(input.previousState);
  const newStateStr = input.newState === undefined ? null : JSON.stringify(input.newState);

  const payload = [
    prevHash,
    id,
    input.actor,
    input.targetIdentity,
    input.action,
    input.category,
    timestamp,
    prevStateStr ?? '',
    newStateStr ?? '',
    input.relatedId ?? '',
    input.outcome,
  ].join('|');

  const eventHash = crypto.createHash('sha256').update(payload).digest('hex');

  db.prepare(
    `INSERT INTO audit_events
      (id, actor, target_identity, action, category, timestamp, previous_state, new_state, related_id, outcome, prev_hash, event_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.actor,
    input.targetIdentity,
    input.action,
    input.category,
    timestamp,
    prevStateStr,
    newStateStr,
    input.relatedId ?? null,
    input.outcome,
    prevHash,
    eventHash
  );

  return { id, eventHash };
}

export function verifyAuditChain(db: DB): {
  valid: boolean;
  checkedCount: number;
  brokenAtId: string | null;
  message: string;
} {
  const rows = db
    .prepare(
      `SELECT seq, id, actor, target_identity, action, category, timestamp,
              previous_state, new_state, related_id, outcome, prev_hash, event_hash
       FROM audit_events ORDER BY seq ASC`
    )
    .all() as Array<{
    seq: number;
    id: string;
    actor: string;
    target_identity: string;
    action: string;
    category: string;
    timestamp: string;
    previous_state: string | null;
    new_state: string | null;
    related_id: string | null;
    outcome: string;
    prev_hash: string;
    event_hash: string;
  }>;

  let expectedPrev = 'GENESIS_MERIDIAN_IAMOPS_V1';
  for (const row of rows) {
    if (row.prev_hash !== expectedPrev) {
      return {
        valid: false,
        checkedCount: rows.length,
        brokenAtId: row.id,
        message: `Chain linkage mismatch at ${row.id}`,
      };
    }
    const payload = [
      row.prev_hash,
      row.id,
      row.actor,
      row.target_identity,
      row.action,
      row.category,
      row.timestamp,
      row.previous_state ?? '',
      row.new_state ?? '',
      row.related_id ?? '',
      row.outcome,
    ].join('|');
    const recomputed = crypto.createHash('sha256').update(payload).digest('hex');
    if (recomputed !== row.event_hash) {
      return {
        valid: false,
        checkedCount: rows.length,
        brokenAtId: row.id,
        message: `Payload hash tamper detected at ${row.id}`,
      };
    }
    expectedPrev = row.event_hash;
  }

  return {
    valid: true,
    checkedCount: rows.length,
    brokenAtId: null,
    message: `Verified ${rows.length} immutable audit records with intact SHA-256 hash chain.`,
  };
}

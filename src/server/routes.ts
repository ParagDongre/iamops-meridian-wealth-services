import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import { recordAuditEvent, verifyAuditChain } from './audit.js';
import type { AppConfig } from './config.js';
import { syncKeycloakIdentity, syncOpenLdapEntry } from './connectors.js';
import type { DB } from './db.js';
import {
  computeSlaDeadline,
  createAccessRequest,
  decideAccessRequestStage,
  evaluateSodForIdentity,
  processWorkItem,
  runJoinerWorkflow,
  runLeaverWorkflow,
  runMoverWorkflow,
  runSlaSweep,
} from './engine.js';
import {
  createAuthMiddleware,
  generateTotpCode,
  generateTotpSecret,
  IpRateLimiter,
  requireRole,
  signJwt,
  verifyPassword,
  verifyTotpCode,
} from './security.js';
import {
  clearAllOperationalData,
  loadDummyDataFromFile,
  loadMeridianCatalog,
  readDummyDataFile,
} from './seed.js';

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  return lines.join('\n');
}

export function buildApiRouter(db: DB, config: AppConfig) {
  const router = express.Router();
  const requireAuth = createAuthMiddleware(db, config);
  const loginLimiter = new IpRateLimiter(15, 60_000);
  const oidcCodeStore = new Map<
    string,
    { operatorId: string; state: string; codeChallenge?: string; createdAt: number }
  >();

  // --- HEALTH & OPENAPI ---
  router.get('/health/live', (_req, res) => {
    res.json({ status: 'ok', service: 'iamops-api', env: config.env });
  });

  router.get('/health/ready', (_req, res) => {
    try {
      const check = db.prepare('SELECT 1 AS ok').get() as { ok: number };
      const lastSweep = db
        .prepare('SELECT * FROM sla_sweep_runs ORDER BY ran_at DESC LIMIT 1')
        .get();
      res.json({
        status: check.ok === 1 ? 'ready' : 'degraded',
        database: 'connected',
        env: config.env,
        keycloakMode: config.keycloakUrl ? 'external_rest' : 'embedded_meridian_idp',
        ldapMode: config.ldapUrl ? 'external_ldap' : 'embedded_openldap_store',
        slaSweepMinutes: config.slaSweepMinutes,
        lastSlaSweep: lastSweep || null,
      });
    } catch (err) {
      res.status(503).json({
        status: 'unavailable',
        error: config.env === 'prod' ? 'Database check failed' : String(err),
      });
    }
  });

  router.get('/api/openapi.json', (_req, res) => {
    if (config.disableApiDocs) {
      res.status(404).json({ error: 'API documentation disabled in production mode' });
      return;
    }
    res.json({
      openapi: '3.0.3',
      info: {
        title: 'IAMOps — Meridian Wealth Services API',
        version: '1.0.0',
        description:
          'Enterprise IAM Operations Lab REST API covering Identity Directory, JML Workflows, RBAC & SoD, Access Requests, Provisioning Queue, ITSM Ticketing, Access Certification, Catalog Admin, and Immutable Audit.',
      },
      paths: {
        '/health/ready': { get: { summary: 'Readiness probe' } },
        '/api/auth/login': { post: { summary: 'Authenticate with lockout, rate limit & MFA' } },
        '/api/auth/oidc/authorize': { get: { summary: 'Initiate OIDC PKCE SSO login' } },
        '/api/identities': { get: { summary: 'Search identities' }, post: { summary: 'Create identity' } },
        '/api/jml/joiner': { post: { summary: 'Execute Joiner onboarding workflow' } },
        '/api/jml/mover': { post: { summary: 'Execute Mover role/dept transition workflow' } },
        '/api/jml/leaver': { post: { summary: 'Execute Leaver termination & zero-privilege revocation' } },
        '/api/requests': { get: { summary: 'List access requests' }, post: { summary: 'Submit access request with SoD guard' } },
        '/api/requests/{id}/decide': { post: { summary: 'Approve or reject current stage' } },
        '/api/provisioning/work-items': { get: { summary: 'List provisioning work items' } },
        '/api/catalog/apps': { post: { summary: 'Create application in Catalog Admin' } },
        '/api/catalog/roles': { post: { summary: 'Create business role in Catalog Admin' } },
        '/api/catalog/sod-policies': { post: { summary: 'Create SoD policy in Catalog Admin' } },
        '/api/tickets': { get: { summary: 'List ITSM tickets' }, post: { summary: 'Create ITSM ticket' } },
        '/api/certifications': { get: { summary: 'List certification campaigns & items' } },
        '/api/audit/verify': { get: { summary: 'Verify SHA-256 audit hash chain integrity' } },
      },
    });
  });

  // --- AUTHENTICATION & SSO ---
  router.get('/api/auth/config', (_req, res) => {
    res.json({
      env: config.env,
      oidcMode: config.keycloakUrl ? 'external_keycloak' : 'meridian_idp_pkce',
      keycloakRealm: config.keycloakRealm,
      tokenTtlMinutes: 30,
      lockoutThreshold: 5,
      // Never expose demo login credentials in production mode
      demoAccounts:
        config.env === 'prod'
          ? []
          : [
              { username: 'iam.admin', role: 'iam_admin', label: 'Elena Vance (IAM Admin)' },
              { username: 'iam.analyst', role: 'iam_analyst', label: 'Marcus Chen (IAM Analyst)' },
              { username: 'wealth.manager', role: 'manager', label: 'Claire Bennett (Manager)' },
              { username: 'app.owner', role: 'app_owner', label: 'Devon Patel (App Owner)' },
              { username: 'compliance.auditor', role: 'auditor', label: 'Nadia Okafor (Auditor)' },
            ],
    });
  });

  router.post('/api/auth/login', (req: Request, res: Response) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const rate = loginLimiter.check(ip);
    if (!rate.allowed) {
      res.status(429).json({
        error: `Too many login attempts from this IP. Retry in ${rate.retryAfterSec}s.`,
        code: 'RATE_LIMITED',
      });
      return;
    }

    const parsed = z
      .object({
        username: z.string().min(1),
        password: z.string().min(1),
        mfaCode: z.string().optional(),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const op = db
      .prepare('SELECT * FROM operator_accounts WHERE username = ? OR email = ?')
      .get(parsed.data.username.trim(), parsed.data.username.trim().toLowerCase()) as
      | {
          id: string;
          username: string;
          email: string;
          full_name: string;
          operator_role: 'iam_admin' | 'iam_analyst' | 'manager' | 'auditor' | 'app_owner';
          password_hash: string;
          mfa_enabled: number;
          mfa_secret: string | null;
          failed_attempts: number;
          locked_until: string | null;
          is_active: number;
        }
      | undefined;

    if (!op) {
      res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
      return;
    }

    if (!op.is_active) {
      res.status(403).json({ error: 'Account is disabled', code: 'ACCOUNT_DISABLED' });
      return;
    }

    const now = new Date();
    if (op.locked_until && new Date(op.locked_until) > now) {
      const minsLeft = Math.ceil((new Date(op.locked_until).getTime() - now.getTime()) / 60_000);
      res.status(423).json({
        error: `Account locked due to 5 failed login attempts. Try again in ${minsLeft} minute(s) or contact IAM Admin.`,
        code: 'ACCOUNT_LOCKED',
      });
      return;
    }

    if (!verifyPassword(parsed.data.password, op.password_hash)) {
      const nextFails = op.failed_attempts + 1;
      const lockUntil =
        nextFails >= 5 ? new Date(now.getTime() + 15 * 60_000).toISOString() : null;
      db.prepare('UPDATE operator_accounts SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(
        nextFails,
        lockUntil,
        op.id
      );

      if (lockUntil) {
        recordAuditEvent(db, {
          actor: op.username,
          targetIdentity: op.email,
          action: 'Account locked after 5 consecutive failed login attempts',
          category: 'security',
          outcome: 'Blocked',
        });
      }

      res.status(lockUntil ? 423 : 401).json({
        error: lockUntil
          ? 'Account locked after 5 failed attempts (15-minute lockout).'
          : `Invalid credentials (${5 - nextFails} attempts remaining before lockout).`,
        code: lockUntil ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS',
      });
      return;
    }

    if (op.mfa_enabled === 1 && op.mfa_secret) {
      if (!parsed.data.mfaCode) {
        res.status(200).json({ mfaRequired: true, username: op.username });
        return;
      }
      if (!verifyTotpCode(op.mfa_secret, parsed.data.mfaCode)) {
        res.status(401).json({ error: 'Invalid 6-digit MFA TOTP code', code: 'INVALID_MFA' });
        return;
      }
    }

    const nowIso = now.toISOString();
    db.prepare(
      'UPDATE operator_accounts SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?'
    ).run(nowIso, op.id);

    const { token, jti, expiresAt } = signJwt(
      {
        id: op.id,
        username: op.username,
        email: op.email,
        full_name: op.full_name,
        operator_role: op.operator_role,
        auth_method: 'password',
      },
      config.jwtSecret,
      30
    );

    db.prepare(
      `INSERT INTO active_sessions (jti, operator_id, auth_method, ip_address, user_agent, issued_at, expires_at)
       VALUES (?, ?, 'password', ?, ?, ?, ?)`
    ).run(jti, op.id, ip, String(req.headers['user-agent'] || ''), nowIso, expiresAt);

    recordAuditEvent(db, {
      actor: op.username,
      targetIdentity: op.email,
      action: 'Operator authenticated via local password' + (op.mfa_enabled ? ' + TOTP MFA' : ''),
      category: 'security',
      outcome: 'Success',
    });

    res.json({
      token,
      expiresAt,
      user: {
        id: op.id,
        username: op.username,
        email: op.email,
        full_name: op.full_name,
        operator_role: op.operator_role,
        auth_method: 'password',
        mfa_enabled: Boolean(op.mfa_enabled),
      },
    });
  });

  // OIDC PKCE Authorize URL
  router.get('/api/auth/oidc/authorize', (req, res) => {
    const state = crypto.randomUUID();
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    const redirectUri = String(req.query.redirect_uri || `${config.appUrl}/`);

    db.prepare(
      'INSERT INTO oidc_states (state, code_verifier, redirect_uri, created_at) VALUES (?, ?, ?, ?)'
    ).run(state, codeVerifier, redirectUri, new Date().toISOString());

    if (config.keycloakUrl) {
      const url = new URL(
        `${config.keycloakUrl}/realms/${config.keycloakRealm}/protocol/openid-connect/auth`
      );
      url.searchParams.set('client_id', config.keycloakClientId);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'openid profile email');
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('state', state);
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
      res.json({ mode: 'external_keycloak', authorizeUrl: url.toString(), state, codeChallenge });
      return;
    }

    res.json({
      mode: 'meridian_idp_pkce',
      state,
      codeChallenge,
      realm: config.keycloakRealm,
      clientId: config.keycloakClientId,
    });
  });

  // Meridian IdP OIDC Consent & Code Issuance (when Keycloak external URL is not configured)
  router.post('/api/auth/oidc/consent', (req, res) => {
    if (config.env === 'prod' && config.keycloakUrl) {
      res.status(400).json({ error: 'Use configured external Keycloak IdP endpoint' });
      return;
    }
    const parsed = z
      .object({
        state: z.string().min(1),
        username: z.string().min(1),
        password: z.string().min(1),
        codeChallenge: z.string().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid OIDC consent payload' });
      return;
    }

    const st = db.prepare('SELECT * FROM oidc_states WHERE state = ?').get(parsed.data.state);
    if (!st) {
      res.status(400).json({ error: 'Invalid or expired OIDC state' });
      return;
    }

    const op = db
      .prepare('SELECT * FROM operator_accounts WHERE username = ? OR email = ?')
      .get(parsed.data.username.trim(), parsed.data.username.trim().toLowerCase()) as
      | { id: string; username: string; password_hash: string; is_active: number }
      | undefined;

    if (!op || !op.is_active || !verifyPassword(parsed.data.password, op.password_hash)) {
      res.status(401).json({ error: 'IdP authentication failed: invalid username or password' });
      return;
    }

    const code = `KC-${crypto.randomBytes(24).toString('base64url')}`;
    oidcCodeStore.set(code, {
      operatorId: op.id,
      state: parsed.data.state,
      codeChallenge: parsed.data.codeChallenge,
      createdAt: Date.now(),
    });

    res.json({ code, state: parsed.data.state });
  });

  router.post('/api/auth/oidc/callback', async (req, res) => {
    const parsed = z
      .object({
        code: z.string().min(1),
        state: z.string().min(1),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Code and state are required' });
      return;
    }

    const st = db
      .prepare('SELECT * FROM oidc_states WHERE state = ?')
      .get(parsed.data.state) as
      | { state: string; code_verifier: string; redirect_uri: string }
      | undefined;
    if (!st) {
      res.status(400).json({ error: 'Invalid or expired OIDC state' });
      return;
    }
    db.prepare('DELETE FROM oidc_states WHERE state = ?').run(parsed.data.state);

    let operatorId: string | null = null;

    if (config.keycloakUrl) {
      try {
        const tokenRes = await fetch(
          `${config.keycloakUrl}/realms/${config.keycloakRealm}/protocol/openid-connect/token`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              client_id: config.keycloakClientId,
              ...(config.keycloakClientSecret ? { client_secret: config.keycloakClientSecret } : {}),
              code: parsed.data.code,
              redirect_uri: st.redirect_uri,
              code_verifier: st.code_verifier,
            }),
          }
        );
        if (!tokenRes.ok) {
          res.status(401).json({ error: `Keycloak token exchange failed (${tokenRes.status})` });
          return;
        }
        const kcTokens = (await tokenRes.json()) as { access_token: string };
        const userInfoRes = await fetch(
          `${config.keycloakUrl}/realms/${config.keycloakRealm}/protocol/openid-connect/userinfo`,
          { headers: { Authorization: `Bearer ${kcTokens.access_token}` } }
        );
        const userInfo = (await userInfoRes.json()) as { email?: string; preferred_username?: string };
        const matched = db
          .prepare('SELECT id FROM operator_accounts WHERE email = ? OR username = ?')
          .get(userInfo.email || '', userInfo.preferred_username || '') as
          | { id: string }
          | undefined;
        operatorId = matched?.id || null;
      } catch (err) {
        res.status(502).json({ error: `Keycloak OIDC callback error: ${String(err)}` });
        return;
      }
    } else {
      const entry = oidcCodeStore.get(parsed.data.code);
      oidcCodeStore.delete(parsed.data.code);
      if (!entry || entry.state !== parsed.data.state || Date.now() - entry.createdAt > 300_000) {
        res.status(401).json({ error: 'Invalid or expired OIDC authorization code' });
        return;
      }
      if (entry.codeChallenge) {
        const expected = crypto.createHash('sha256').update(st.code_verifier).digest('base64url');
        if (expected !== entry.codeChallenge) {
          res.status(401).json({ error: 'PKCE code_verifier mismatch' });
          return;
        }
      }
      operatorId = entry.operatorId;
    }

    if (!operatorId) {
      res.status(403).json({ error: 'No matching IAMOps operator mapped to OIDC subject' });
      return;
    }

    const op = db.prepare('SELECT * FROM operator_accounts WHERE id = ?').get(operatorId) as {
      id: string;
      username: string;
      email: string;
      full_name: string;
      operator_role: 'iam_admin' | 'iam_analyst' | 'manager' | 'auditor' | 'app_owner';
      mfa_enabled: number;
    };

    const nowIso = new Date().toISOString();
    const { token, jti, expiresAt } = signJwt(
      {
        id: op.id,
        username: op.username,
        email: op.email,
        full_name: op.full_name,
        operator_role: op.operator_role,
        auth_method: 'oidc_sso',
      },
      config.jwtSecret,
      30
    );

    db.prepare(
      `INSERT INTO active_sessions (jti, operator_id, auth_method, ip_address, user_agent, issued_at, expires_at)
       VALUES (?, ?, 'oidc_sso', ?, ?, ?, ?)`
    ).run(jti, op.id, req.ip || 'unknown', String(req.headers['user-agent'] || ''), nowIso, expiresAt);

    recordAuditEvent(db, {
      actor: op.username,
      targetIdentity: op.email,
      action: `Operator authenticated via OIDC PKCE SSO (realm: ${config.keycloakRealm})`,
      category: 'security',
      outcome: 'Success',
    });

    res.json({
      token,
      expiresAt,
      user: {
        id: op.id,
        username: op.username,
        email: op.email,
        full_name: op.full_name,
        operator_role: op.operator_role,
        auth_method: 'oidc_sso',
        mfa_enabled: Boolean(op.mfa_enabled),
      },
    });
  });

  router.post('/api/auth/logout', requireAuth, (req, res) => {
    const user = req.user!;
    const now = new Date().toISOString();
    const sess = db
      .prepare('SELECT expires_at FROM active_sessions WHERE jti = ?')
      .get(user.jti) as { expires_at: string } | undefined;
    db.prepare(
      `INSERT OR IGNORE INTO revoked_tokens (jti, operator_id, reason, revoked_by, revoked_at, expires_at)
       VALUES (?, ?, 'User sign-out', ?, ?, ?)`
    ).run(
      user.jti,
      user.id,
      user.username,
      now,
      sess?.expires_at || new Date(Date.now() + 1800_000).toISOString()
    );
    db.prepare('UPDATE active_sessions SET revoked_at = ? WHERE jti = ?').run(now, user.jti);
    recordAuditEvent(db, {
      actor: user.username,
      targetIdentity: user.email,
      action: 'Operator session signed out and JWT revoked',
      category: 'security',
      outcome: 'Success',
    });
    res.json({ ok: true });
  });

  router.get('/api/auth/me', requireAuth, (req, res) => {
    const op = db
      .prepare('SELECT mfa_enabled, last_login_at FROM operator_accounts WHERE id = ?')
      .get(req.user!.id) as { mfa_enabled: number; last_login_at: string | null } | undefined;
    res.json({
      user: {
        ...req.user,
        mfa_enabled: Boolean(op?.mfa_enabled),
        last_login_at: op?.last_login_at || null,
      },
    });
  });

  router.get('/api/auth/sessions', requireAuth, (req, res) => {
    const rows =
      req.user!.operator_role === 'iam_admin'
        ? db
            .prepare(
              `SELECT s.*, o.username, o.full_name, o.operator_role
               FROM active_sessions s
               JOIN operator_accounts o ON o.id = s.operator_id
               ORDER BY s.issued_at DESC LIMIT 40`
            )
            .all()
        : db
            .prepare(
              `SELECT s.*, o.username, o.full_name, o.operator_role
               FROM active_sessions s
               JOIN operator_accounts o ON o.id = s.operator_id
               WHERE s.operator_id = ?
               ORDER BY s.issued_at DESC LIMIT 20`
            )
            .all(req.user!.id);
    res.json({ sessions: rows });
  });

  router.post('/api/auth/sessions/:jti/revoke', requireAuth, (req, res) => {
    const jti = req.params.jti;
    const sess = db
      .prepare('SELECT * FROM active_sessions WHERE jti = ?')
      .get(jti) as { jti: string; operator_id: string; expires_at: string } | undefined;
    if (!sess) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (sess.operator_id !== req.user!.id && req.user!.operator_role !== 'iam_admin') {
      res.status(403).json({ error: 'Cannot revoke another operator session' });
      return;
    }
    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR IGNORE INTO revoked_tokens (jti, operator_id, reason, revoked_by, revoked_at, expires_at)
       VALUES (?, ?, 'Administrative session revocation', ?, ?, ?)`
    ).run(jti, sess.operator_id, req.user!.username, now, sess.expires_at);
    db.prepare('UPDATE active_sessions SET revoked_at = ? WHERE jti = ?').run(now, jti);
    recordAuditEvent(db, {
      actor: req.user!.username,
      targetIdentity: sess.operator_id,
      action: `JWT Session Revoked (${jti.slice(0, 8)})`,
      category: 'security',
      outcome: 'Success',
    });
    res.json({ ok: true });
  });

  router.post('/api/auth/mfa/enroll', requireAuth, (req, res) => {
    const secret = generateTotpSecret();
    db.prepare('UPDATE operator_accounts SET mfa_secret = ? WHERE id = ?').run(secret, req.user!.id);
    const otpauthUri = `otpauth://totp/MeridianIAMOps:${encodeURIComponent(req.user!.username)}?secret=${secret}&issuer=MeridianWealthIAMOps`;
    res.json({
      secret,
      otpauthUri,
      currentSampleCode: config.env === 'prod' ? undefined : generateTotpCode(secret, 0),
    });
  });

  router.post('/api/auth/mfa/verify-setup', requireAuth, (req, res) => {
    const code = String(req.body?.code || '');
    const op = db
      .prepare('SELECT mfa_secret FROM operator_accounts WHERE id = ?')
      .get(req.user!.id) as { mfa_secret: string | null } | undefined;
    if (!op?.mfa_secret || !verifyTotpCode(op.mfa_secret, code)) {
      res.status(400).json({ error: 'Invalid 6-digit TOTP code' });
      return;
    }
    db.prepare('UPDATE operator_accounts SET mfa_enabled = 1 WHERE id = ?').run(req.user!.id);
    recordAuditEvent(db, {
      actor: req.user!.username,
      targetIdentity: req.user!.email,
      action: 'TOTP Multi-Factor Authentication enabled',
      category: 'security',
      outcome: 'Success',
    });
    res.json({ ok: true, mfa_enabled: true });
  });

  router.post('/api/auth/mfa/disable', requireAuth, (req, res) => {
    db.prepare('UPDATE operator_accounts SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?').run(
      req.user!.id
    );
    recordAuditEvent(db, {
      actor: req.user!.username,
      targetIdentity: req.user!.email,
      action: 'TOTP Multi-Factor Authentication disabled',
      category: 'security',
      outcome: 'Warning',
    });
    res.json({ ok: true, mfa_enabled: false });
  });

  router.post('/api/auth/operators/:id/unlock', requireAuth, requireRole('iam_admin'), (req, res) => {
    db.prepare('UPDATE operator_accounts SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(
      req.params.id
    );
    recordAuditEvent(db, {
      actor: req.user!.username,
      targetIdentity: req.params.id,
      action: 'Operator lockout cleared by IAM Admin',
      category: 'security',
      outcome: 'Success',
    });
    res.json({ ok: true });
  });

  // --- DASHBOARD & SLA REPORTING ---
  router.get('/api/dashboard/overview', requireAuth, (_req, res) => {
    const activeIdentities = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM identities WHERE lifecycle_status = 'Active'`).get() as { cnt: number }
    ).cnt;
    const totalIdentities = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM identities`).get() as { cnt: number }
    ).cnt;
    const pendingRequests = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM access_requests WHERE completion_status IN ('Open', 'Provisioning')`).get() as { cnt: number }
    ).cnt;
    const awaitingApproval = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM access_requests WHERE approval_status = 'Pending Approval'`).get() as { cnt: number }
    ).cnt;
    const totalWorkItems = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM provisioning_work_items`).get() as { cnt: number }
    ).cnt;
    const queuedWorkItems = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM provisioning_work_items WHERE status = 'Queued'`).get() as { cnt: number }
    ).cnt;
    const successfulProvisioning = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM provisioning_work_items WHERE status = 'Fulfilled'`).get() as { cnt: number }
    ).cnt;
    const failedProvisioning = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM provisioning_work_items WHERE status = 'Failed'`).get() as { cnt: number }
    ).cnt;
    const openTickets = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM tickets WHERE status IN ('Open', 'In Progress', 'Escalated')`).get() as { cnt: number }
    ).cnt;
    const overdueRequests = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM access_requests WHERE is_sla_breached = 1 AND completion_status IN ('Open', 'Provisioning')`).get() as { cnt: number }
    ).cnt;

    const totalRequests = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM access_requests`).get() as { cnt: number }
    ).cnt;
    const nonBreachedRequests = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM access_requests WHERE is_sla_breached = 0`).get() as { cnt: number }
    ).cnt;
    const slaCompliancePct =
      totalRequests > 0 ? Math.round((nonBreachedRequests / totalRequests) * 1000) / 10 : 0;

    const avgFulfillRow = db
      .prepare(
        `SELECT AVG((julianday(completed_at) - julianday(created_at)) * 24.0) AS avg_hours
         FROM access_requests WHERE completed_at IS NOT NULL`
      )
      .get() as { avg_hours: number | null };

    const certTotal = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM certification_items`).get() as { cnt: number }
    ).cnt;
    const certDone = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM certification_items WHERE decision != 'Pending'`).get() as { cnt: number }
    ).cnt;
    const accessReviewCompletionPct =
      certTotal > 0 ? Math.round((certDone / certTotal) * 1000) / 10 : 0;

    const openSodViolations = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM sod_violations WHERE status = 'Open'`).get() as { cnt: number }
    ).cnt;

    const requestVolumeByDay = db
      .prepare(
        `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count
         FROM access_requests GROUP BY substr(created_at, 1, 10) ORDER BY day ASC`
      )
      .all();

    const provisioningTrends = db
      .prepare(
        `SELECT substr(created_at, 1, 10) AS day,
                SUM(CASE WHEN status = 'Fulfilled' THEN 1 ELSE 0 END) AS fulfilled,
                SUM(CASE WHEN status = 'Failed' THEN 1 ELSE 0 END) AS failed,
                SUM(CASE WHEN status = 'Queued' THEN 1 ELSE 0 END) AS queued
         FROM provisioning_work_items GROUP BY substr(created_at, 1, 10) ORDER BY day ASC`
      )
      .all();

    const ticketPriorityDistribution = db
      .prepare(
        `SELECT priority, COUNT(*) AS count FROM tickets GROUP BY priority`
      )
      .all();

    const slaByApplication = db
      .prepare(
        `SELECT a.name AS application,
                COUNT(ar.id) AS total_requests,
                SUM(CASE WHEN ar.is_sla_breached = 0 THEN 1 ELSE 0 END) AS on_time,
                SUM(CASE WHEN ar.is_sla_breached = 1 THEN 1 ELSE 0 END) AS breached
         FROM applications a
         LEFT JOIN access_requests ar ON ar.application_id = a.id
         GROUP BY a.id, a.name ORDER BY total_requests DESC`
      )
      .all();

    const workItemAgeing = db
      .prepare(
        `SELECT work_item_number, action, status, priority, retry_count, escalated_to_l2, is_sla_breached,
                ROUND((julianday('now') - julianday(created_at)) * 24.0, 1) AS age_hours
         FROM provisioning_work_items
         WHERE status != 'Fulfilled'
         ORDER BY age_hours DESC`
      )
      .all();

    const analystWorkload = db
      .prepare(
        `SELECT assigned_analyst AS analyst,
                COUNT(*) AS total_tickets,
                SUM(CASE WHEN status IN ('Open', 'In Progress', 'Escalated') THEN 1 ELSE 0 END) AS active_tickets,
                SUM(CASE WHEN is_sla_breached = 1 THEN 1 ELSE 0 END) AS breached_tickets
         FROM tickets GROUP BY assigned_analyst ORDER BY active_tickets DESC`
      )
      .all();

    res.json({
      kpis: {
        activeIdentities,
        totalIdentities,
        pendingRequests,
        awaitingApproval,
        totalWorkItems,
        queuedWorkItems,
        successfulProvisioning,
        failedProvisioning,
        openTickets,
        slaCompliancePct,
        avgFulfillmentHours: avgFulfillRow.avg_hours ? Math.round(avgFulfillRow.avg_hours * 10) / 10 : 0,
        overdueRequests,
        accessReviewCompletionPct,
        openSodViolations,
      },
      charts: {
        requestVolumeByDay,
        provisioningTrends,
        ticketPriorityDistribution,
        slaByApplication,
        workItemAgeing,
        analystWorkload,
      },
    });
  });

  router.post('/api/sla/sweep', requireAuth, requireRole('iam_admin', 'iam_analyst'), (req, res) => {
    const result = runSlaSweep(db, req.user!.username);
    res.json(result);
  });

  router.get('/api/sla/report', requireAuth, (_req, res) => {
    const sweeps = db.prepare('SELECT * FROM sla_sweep_runs ORDER BY ran_at DESC LIMIT 15').all();
    const overdueRequests = db
      .prepare(
        `SELECT ar.*, i.full_name AS target_name, a.name AS app_name, e.name AS ent_name
         FROM access_requests ar
         JOIN identities i ON i.id = ar.target_identity_id
         JOIN applications a ON a.id = ar.application_id
         JOIN entitlements e ON e.id = ar.entitlement_id
         WHERE ar.is_sla_breached = 1 AND ar.completion_status IN ('Open', 'Provisioning')`
      )
      .all();
    const overdueWorkItems = db
      .prepare(
        `SELECT w.*, i.full_name AS target_name, a.name AS app_name
         FROM provisioning_work_items w
         JOIN identities i ON i.id = w.identity_id
         LEFT JOIN applications a ON a.id = w.application_id
         WHERE w.is_sla_breached = 1 AND w.status != 'Fulfilled'`
      )
      .all();
    const overdueTickets = db
      .prepare(
        `SELECT * FROM tickets WHERE is_sla_breached = 1 AND status IN ('Open', 'In Progress', 'Escalated')`
      )
      .all();
    res.json({ sweeps, overdueRequests, overdueWorkItems, overdueTickets });
  });

  // --- IDENTITIES ---
  router.get('/api/identities', requireAuth, (req, res) => {
    const search = String(req.query.search || '').trim().toLowerCase();
    const dept = String(req.query.department || '').trim();
    const status = String(req.query.status || '').trim();

    let rows = db
      .prepare(
        `SELECT i.*, br.name AS role_name, m.full_name AS manager_name,
                (SELECT COUNT(*) FROM app_accounts aa WHERE aa.identity_id = i.id AND aa.status = 'Active') AS active_apps_count,
                (SELECT COUNT(*) FROM identity_entitlements ie WHERE ie.identity_id = i.id AND ie.status = 'Active') AS active_entitlements_count
         FROM identities i
         LEFT JOIN business_roles br ON br.id = i.business_role_id
         LEFT JOIN identities m ON m.id = i.manager_id
         ORDER BY i.employee_id ASC`
      )
      .all() as Array<Record<string, unknown>>;

    if (search) {
      rows = rows.filter(
        (r) =>
          String(r.full_name).toLowerCase().includes(search) ||
          String(r.email).toLowerCase().includes(search) ||
          String(r.employee_id).toLowerCase().includes(search) ||
          String(r.job_title).toLowerCase().includes(search)
      );
    }
    if (dept && dept !== 'All') {
      rows = rows.filter((r) => r.department === dept);
    }
    if (status && status !== 'All') {
      rows = rows.filter((r) => r.lifecycle_status === status);
    }

    res.json({ identities: rows });
  });

  router.get('/api/identities/:id', requireAuth, (req, res) => {
    const identity = db
      .prepare(
        `SELECT i.*, br.name AS role_name, m.full_name AS manager_name
         FROM identities i
         LEFT JOIN business_roles br ON br.id = i.business_role_id
         LEFT JOIN identities m ON m.id = i.manager_id
         WHERE i.id = ?`
      )
      .get(req.params.id) as Record<string, unknown> | undefined;

    if (!identity) {
      res.status(404).json({ error: 'Identity not found' });
      return;
    }

    const appAccounts = db
      .prepare(
        `SELECT aa.*, a.name AS app_name, a.code AS app_code
         FROM app_accounts aa
         JOIN applications a ON a.id = aa.application_id
         WHERE aa.identity_id = ?`
      )
      .all(req.params.id);

    const entitlements = db
      .prepare(
        `SELECT ie.*, e.name AS entitlement_name, e.code AS entitlement_code, e.sensitivity, a.name AS app_name
         FROM identity_entitlements ie
         JOIN entitlements e ON e.id = ie.entitlement_id
         JOIN applications a ON a.id = e.application_id
         WHERE ie.identity_id = ? ORDER BY ie.status ASC, ie.granted_at DESC`
      )
      .all(req.params.id);

    const groups = db
      .prepare(
        `SELECT dg.* FROM group_memberships gm
         JOIN directory_groups dg ON dg.id = gm.group_id
         WHERE gm.identity_id = ?`
      )
      .all(req.params.id);

    const pendingRequests = db
      .prepare(
        `SELECT ar.*, a.name AS app_name, e.name AS ent_name
         FROM access_requests ar
         JOIN applications a ON a.id = ar.application_id
         JOIN entitlements e ON e.id = ar.entitlement_id
         WHERE ar.target_identity_id = ? ORDER BY ar.created_at DESC`
      )
      .all(req.params.id);

    const idpAccount = db
      .prepare('SELECT * FROM idp_accounts WHERE identity_id = ?')
      .get(req.params.id);
    const ldapEntry = db
      .prepare('SELECT * FROM ldap_entries WHERE identity_id = ?')
      .get(req.params.id);
    const history = db
      .prepare('SELECT * FROM audit_events WHERE target_identity = ? ORDER BY seq DESC LIMIT 30')
      .all(String(identity.email));

    res.json({
      identity,
      appAccounts,
      entitlements,
      groups,
      pendingRequests,
      idpAccount,
      ldapEntry,
      history,
    });
  });

  router.post('/api/identities', requireAuth, requireRole('iam_admin', 'iam_analyst'), async (req, res) => {
    const parsed = z
      .object({
        fullName: z.string().min(2),
        email: z.string().email(),
        department: z.string().min(2),
        jobTitle: z.string().min(2),
        managerId: z.string().nullable().optional(),
        employmentType: z.string().default('Full-Time'),
        location: z.string().min(2),
        joiningDate: z.string().min(4),
        businessRoleId: z.string().min(1),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid identity payload' });
      return;
    }

    const exists = db.prepare('SELECT 1 FROM identities WHERE email = ?').get(parsed.data.email.toLowerCase());
    if (exists) {
      res.status(409).json({ error: 'An identity with this email already exists' });
      return;
    }

    const now = new Date().toISOString();
    const id = `ID-${crypto.randomUUID().slice(0, 8)}`;
    const cnt = (db.prepare('SELECT COUNT(*) AS cnt FROM identities').get() as { cnt: number }).cnt;
    const empId = `EMP-${1001 + cnt}`;

    db.prepare(
      `INSERT INTO identities
        (id, employee_id, full_name, email, department, job_title, manager_id, employment_type,
         location, joining_date, employment_status, lifecycle_status, business_role_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', 'Active', ?, ?, ?)`
    ).run(
      id,
      empId,
      parsed.data.fullName,
      parsed.data.email.toLowerCase(),
      parsed.data.department,
      parsed.data.jobTitle,
      parsed.data.managerId || null,
      parsed.data.employmentType,
      parsed.data.location,
      parsed.data.joiningDate,
      parsed.data.businessRoleId,
      now,
      now
    );

    await syncKeycloakIdentity(db, config, id, 'upsert');
    syncOpenLdapEntry(db, config, id, 'upsert');

    recordAuditEvent(db, {
      actor: req.user!.username,
      targetIdentity: parsed.data.email.toLowerCase(),
      action: `Identity Created (${empId}): ${parsed.data.fullName}`,
      category: 'identity',
      newState: parsed.data,
      relatedId: empId,
      outcome: 'Success',
    });

    res.status(201).json({ identity: db.prepare('SELECT * FROM identities WHERE id = ?').get(id) });
  });

  router.patch('/api/identities/:id', requireAuth, requireRole('iam_admin', 'iam_analyst'), async (req, res) => {
    const existing = db.prepare('SELECT * FROM identities WHERE id = ?').get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Identity not found' });
      return;
    }

    const parsed = z
      .object({
        fullName: z.string().min(2).optional(),
        department: z.string().min(2).optional(),
        jobTitle: z.string().min(2).optional(),
        location: z.string().min(2).optional(),
        managerId: z.string().nullable().optional(),
        businessRoleId: z.string().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid update payload' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE identities
       SET full_name = ?, department = ?, job_title = ?, location = ?, manager_id = ?, business_role_id = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      String(parsed.data.fullName ?? existing.full_name),
      String(parsed.data.department ?? existing.department),
      String(parsed.data.jobTitle ?? existing.job_title),
      String(parsed.data.location ?? existing.location),
      (parsed.data.managerId !== undefined ? parsed.data.managerId : existing.manager_id) as string | null,
      (parsed.data.businessRoleId ?? existing.business_role_id) as string | null,
      now,
      req.params.id
    );

    await syncKeycloakIdentity(db, config, req.params.id, 'upsert');
    syncOpenLdapEntry(db, config, req.params.id, 'upsert');

    recordAuditEvent(db, {
      actor: req.user!.username,
      targetIdentity: String(existing.email),
      action: `Identity Updated (${existing.employee_id})`,
      category: 'identity',
      previousState: existing,
      newState: parsed.data,
      relatedId: String(existing.employee_id),
      outcome: 'Success',
    });

    res.json({ identity: db.prepare('SELECT * FROM identities WHERE id = ?').get(req.params.id) });
  });

  router.post('/api/identities/:id/status', requireAuth, requireRole('iam_admin', 'iam_analyst'), async (req, res) => {
    const targetStatus = req.body?.lifecycleStatus;
    if (targetStatus !== 'Active' && targetStatus !== 'Disabled') {
      res.status(400).json({ error: 'lifecycleStatus must be Active or Disabled' });
      return;
    }
    if (targetStatus === 'Disabled') {
      const result = await runLeaverWorkflow(
        db,
        config,
        { identityId: req.params.id, terminationReason: req.body?.reason || 'Manual deactivation from Identity Directory' },
        req.user!.username
      );
      res.status(result.status).json(result);
      return;
    }

    const now = new Date().toISOString();
    const existing = db.prepare('SELECT * FROM identities WHERE id = ?').get(req.params.id) as
      | { email: string; employee_id: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Identity not found' });
      return;
    }
    db.prepare(
      `UPDATE identities SET employment_status = 'Active', lifecycle_status = 'Active', updated_at = ? WHERE id = ?`
    ).run(now, req.params.id);
    await syncKeycloakIdentity(db, config, req.params.id, 'enable');
    syncOpenLdapEntry(db, config, req.params.id, 'unlock');
    recordAuditEvent(db, {
      actor: req.user!.username,
      targetIdentity: existing.email,
      action: `Identity Reactivated (${existing.employee_id})`,
      category: 'identity',
      outcome: 'Success',
    });
    res.json({ identity: db.prepare('SELECT * FROM identities WHERE id = ?').get(req.params.id) });
  });

  // --- JML WORKFLOWS ---
  router.post('/api/jml/joiner', requireAuth, requireRole('iam_admin', 'iam_analyst'), async (req, res) => {
    const parsed = z
      .object({
        fullName: z.string().min(2),
        email: z.string().email(),
        department: z.string().min(2),
        jobTitle: z.string().min(2),
        managerId: z.string().nullable().optional(),
        employmentType: z.string().default('Full-Time'),
        location: z.string().min(2),
        joiningDate: z.string().min(4),
        businessRoleId: z.string().min(1),
        autoApproveStandard: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid Joiner payload' });
      return;
    }
    const result = await runJoinerWorkflow(db, config, parsed.data, req.user!.username);
    res.status(result.status).json(result);
  });

  router.post('/api/jml/mover', requireAuth, requireRole('iam_admin', 'iam_analyst'), async (req, res) => {
    const parsed = z
      .object({
        identityId: z.string().min(1),
        newDepartment: z.string().min(2),
        newJobTitle: z.string().min(2),
        newManagerId: z.string().nullable().optional(),
        newBusinessRoleId: z.string().min(1),
        justification: z.string().min(3),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid Mover payload' });
      return;
    }
    const result = await runMoverWorkflow(db, config, parsed.data, req.user!.username);
    res.status(result.status).json(result);
  });

  router.post('/api/jml/leaver', requireAuth, requireRole('iam_admin', 'iam_analyst'), async (req, res) => {
    const parsed = z
      .object({
        identityId: z.string().min(1),
        terminationReason: z.string().min(3),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'identityId and terminationReason are required' });
      return;
    }
    const result = await runLeaverWorkflow(db, config, parsed.data, req.user!.username);
    res.status(result.status).json(result);
  });

  // --- CATALOG ADMIN & RBAC / SOD ---
  router.get('/api/catalog', requireAuth, (_req, res) => {
    const applications = db.prepare('SELECT * FROM applications ORDER BY name ASC').all();
    const entitlements = db
      .prepare(
        `SELECT e.*, a.name AS app_name, a.code AS app_code
         FROM entitlements e
         JOIN applications a ON a.id = e.application_id
         ORDER BY a.name ASC, e.name ASC`
      )
      .all();
    const roles = db.prepare('SELECT * FROM business_roles ORDER BY name ASC').all() as Array<
      Record<string, unknown>
    >;
    for (const r of roles) {
      r.entitlements = db
        .prepare(
          `SELECT e.id, e.name, e.code, e.sensitivity, a.name AS app_name
           FROM role_entitlements re
           JOIN entitlements e ON e.id = re.entitlement_id
           JOIN applications a ON a.id = e.application_id
           WHERE re.role_id = ?`
        )
        .all(String(r.id));
    }
    const groups = db
      .prepare(
        `SELECT dg.*, a.name AS app_name,
                (SELECT COUNT(*) FROM group_memberships gm WHERE gm.group_id = dg.id) AS member_count
         FROM directory_groups dg
         LEFT JOIN applications a ON a.id = dg.application_id
         ORDER BY dg.name ASC`
      )
      .all();
    const sodPolicies = db
      .prepare(
        `SELECT sp.*, ea.name AS entitlement_a_name, eb.name AS entitlement_b_name
         FROM sod_policies sp
         JOIN entitlements ea ON ea.id = sp.entitlement_a_id
         JOIN entitlements eb ON eb.id = sp.entitlement_b_id
         ORDER BY sp.created_at DESC`
      )
      .all();
    const sodViolations = db
      .prepare(
        `SELECT sv.*, sp.name AS policy_name, sp.severity, i.full_name AS identity_name, i.email AS identity_email
         FROM sod_violations sv
         JOIN sod_policies sp ON sp.id = sv.policy_id
         JOIN identities i ON i.id = sv.identity_id
         ORDER BY sv.detected_at DESC`
      )
      .all();

    res.json({ applications, entitlements, roles, groups, sodPolicies, sodViolations });
  });

  router.post('/api/catalog/bootstrap-meridian', requireAuth, requireRole('iam_admin'), (req, res) => {
    loadMeridianCatalog(db, req.user!.username);
    res.json({ ok: true, message: 'Meridian Wealth Services baseline catalog loaded.' });
  });

  router.post('/api/catalog/apps', requireAuth, requireRole('iam_admin'), (req, res) => {
    const parsed = z
      .object({
        name: z.string().min(2),
        code: z.string().min(2).max(16),
        ownerName: z.string().min(2),
        ownerEmail: z.string().email(),
        criticality: z.enum(['low', 'medium', 'high', 'critical']),
        connectorType: z.string().min(2),
        description: z.string().min(3),
        slaHours: z.number().int().min(1).max(720).default(24),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid application payload' });
      return;
    }
    const id = `APP-${parsed.data.code.toUpperCase()}-${crypto.randomUUID().slice(0, 4)}`;
    const now = new Date().toISOString();
    try {
      db.prepare(
        `INSERT INTO applications (id, name, code, owner_name, owner_email, criticality, connector_type, description, sla_hours, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        parsed.data.name,
        parsed.data.code.toUpperCase(),
        parsed.data.ownerName,
        parsed.data.ownerEmail,
        parsed.data.criticality,
        parsed.data.connectorType,
        parsed.data.description,
        parsed.data.slaHours,
        now
      );
    } catch {
      res.status(409).json({ error: 'Application name or code already exists' });
      return;
    }
    recordAuditEvent(db, {
      actor: req.user!.username,
      targetIdentity: parsed.data.code.toUpperCase(),
      action: `Catalog Admin Created Application: ${parsed.data.name}`,
      category: 'catalog',
      newState: parsed.data,
      outcome: 'Success',
    });
    res.status(201).json({ application: db.prepare('SELECT * FROM applications WHERE id = ?').get(id) });
  });

  router.patch('/api/catalog/apps/:id', requireAuth, requireRole('iam_admin', 'iam_analyst'), (req, res) => {
    const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!app) {
      res.status(404).json({ error: 'Application not found' });
      return;
    }
    const simulateFailure =
      typeof req.body?.simulateFailure === 'boolean'
        ? req.body.simulateFailure
          ? 1
          : 0
        : app.simulate_failure;
    const slaHours = typeof req.body?.slaHours === 'number' ? req.body.slaHours : app.sla_hours;
    const ownerName = typeof req.body?.ownerName === 'string' ? req.body.ownerName : app.owner_name;

    db.prepare('UPDATE applications SET simulate_failure = ?, sla_hours = ?, owner_name = ? WHERE id = ?').run(
      Number(simulateFailure),
      Number(slaHours),
      String(ownerName),
      req.params.id
    );
    recordAuditEvent(db, {
      actor: req.user!.username,
      targetIdentity: String(app.code),
      action: `Application Updated (${app.name}): simulateFailure=${Boolean(simulateFailure)}`,
      category: 'catalog',
      outcome: 'Success',
    });
    res.json({ application: db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id) });
  });

  router.delete('/api/catalog/apps/:id', requireAuth, requireRole('iam_admin'), (req, res) => {
    const app = db.prepare('SELECT name, code FROM applications WHERE id = ?').get(req.params.id) as
      | { name: string; code: string }
      | undefined;
    if (!app) {
      res.status(404).json({ error: 'Application not found' });
      return;
    }
    db.prepare('DELETE FROM applications WHERE id = ?').run(req.params.id);
    recordAuditEvent(db, {
      actor: req.user!.username,
      targetIdentity: app.code,
      action: `Catalog Admin Deleted Application: ${app.name}`,
      category: 'catalog',
      outcome: 'Warning',
    });
    res.json({ ok: true });
  });

  router.post('/api/catalog/entitlements', requireAuth, requireRole('iam_admin'), (req, res) => {
    const parsed = z
      .object({
        applicationId: z.string().min(1),
        name: z.string().min(2),
        code: z.string().min(2),
        description: z.string().min(3),
        sensitivity: z.enum(['standard', 'high', 'critical']),
        requiresComplianceApproval: z.boolean().default(false),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid entitlement payload' });
      return;
    }
    const id = `ENT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const now = new Date().toISOString();
    try {
      db.prepare(
        `INSERT INTO entitlements (id, application_id, name, code, description, sensitivity, requires_compliance_approval, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        parsed.data.applicationId,
        parsed.data.name,
        parsed.data.code.toUpperCase(),
        parsed.data.description,
        parsed.data.sensitivity,
        parsed.data.requiresComplianceApproval ? 1 : 0,
        now
      );
    } catch {
      res.status(409).json({ error: 'Entitlement code already exists or application missing' });
      return;
    }
    recordAuditEvent(db, {
      actor: req.user!.username,
      targetIdentity: parsed.data.code.toUpperCase(),
      action: `Catalog Admin Created Entitlement: ${parsed.data.name}`,
      category: 'catalog',
      newState: parsed.data,
      outcome: 'Success',
    });
    res.status(201).json({ entitlement: db.prepare('SELECT * FROM entitlements WHERE id = ?').get(id) });
  });

  router.delete('/api/catalog/entitlements/:id', requireAuth, requireRole('iam_admin'), (req, res) => {
    db.prepare('DELETE FROM entitlements WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  router.post('/api/catalog/roles', requireAuth, requireRole('iam_admin'), (req, res) => {
    const parsed = z
      .object({
        name: z.string().min(2),
        department: z.string().min(2),
        description: z.string().min(3),
        riskLevel: z.enum(['standard', 'high', 'critical']).default('standard'),
        entitlementIds: z.array(z.string()).default([]),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid role payload' });
      return;
    }
    const id = `ROLE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const now = new Date().toISOString();
    try {
      db.prepare(
        `INSERT INTO business_roles (id, name, department, description, risk_level, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, parsed.data.name, parsed.data.department, parsed.data.description, parsed.data.riskLevel, now);
    } catch {
      res.status(409).json({ error: 'Business role name already exists' });
      return;
    }
    for (const entId of parsed.data.entitlementIds) {
      db.prepare('INSERT OR IGNORE INTO role_entitlements (id, role_id, entitlement_id) VALUES (?, ?, ?)').run(
        `RE-${id}-${entId}`,
        id,
        entId
      );
    }
    recordAuditEvent(db, {
      actor: req.user!.username,
      targetIdentity: parsed.data.name,
      action: `Catalog Admin Created Business Role: ${parsed.data.name}`,
      category: 'catalog',
      newState: parsed.data,
      outcome: 'Success',
    });
    res.status(201).json({ role: db.prepare('SELECT * FROM business_roles WHERE id = ?').get(id) });
  });

  router.put('/api/catalog/roles/:id/entitlements', requireAuth, requireRole('iam_admin'), (req, res) => {
    const entIds = z.array(z.string()).safeParse(req.body?.entitlementIds);
    if (!entIds.success) {
      res.status(400).json({ error: 'entitlementIds array required' });
      return;
    }
    db.prepare('DELETE FROM role_entitlements WHERE role_id = ?').run(req.params.id);
    for (const eid of entIds.data) {
      db.prepare('INSERT OR IGNORE INTO role_entitlements (id, role_id, entitlement_id) VALUES (?, ?, ?)').run(
        `RE-${req.params.id}-${eid}`,
        req.params.id,
        eid
      );
    }
    recordAuditEvent(db, {
      actor: req.user!.username,
      targetIdentity: req.params.id,
      action: `Catalog Admin Updated Role Entitlement Mappings (${entIds.data.length} mapped)`,
      category: 'catalog',
      outcome: 'Success',
    });
    res.json({ ok: true });
  });

  router.delete('/api/catalog/roles/:id', requireAuth, requireRole('iam_admin'), (req, res) => {
    db.prepare('DELETE FROM business_roles WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  router.post('/api/catalog/groups', requireAuth, requireRole('iam_admin'), (req, res) => {
    const parsed = z
      .object({
        name: z.string().min(2),
        dn: z.string().min(5),
        description: z.string().min(3),
        applicationId: z.string().nullable().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid directory group payload' });
      return;
    }
    const id = `GRP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    try {
      db.prepare(
        `INSERT INTO directory_groups (id, name, dn, description, application_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        parsed.data.name,
        parsed.data.dn,
        parsed.data.description,
        parsed.data.applicationId || null,
        new Date().toISOString()
      );
    } catch {
      res.status(409).json({ error: 'Group name or DN already exists' });
      return;
    }
    res.status(201).json({ group: db.prepare('SELECT * FROM directory_groups WHERE id = ?').get(id) });
  });

  router.post('/api/catalog/sod-policies', requireAuth, requireRole('iam_admin'), (req, res) => {
    const parsed = z
      .object({
        name: z.string().min(3),
        description: z.string().min(3),
        entitlementAId: z.string().min(1),
        entitlementBId: z.string().min(1),
        severity: z.enum(['medium', 'high', 'critical']),
        enforcementAction: z.enum(['block', 'warn']).default('block'),
      })
      .safeParse(req.body);
    if (!parsed.success || parsed.data.entitlementAId === parsed.data.entitlementBId) {
      res.status(400).json({ error: 'Valid SoD policy with two distinct entitlements is required' });
      return;
    }
    const id = `SOD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    try {
      db.prepare(
        `INSERT INTO sod_policies (id, name, description, entitlement_a_id, entitlement_b_id, severity, enforcement_action, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
      ).run(
        id,
        parsed.data.name,
        parsed.data.description,
        parsed.data.entitlementAId,
        parsed.data.entitlementBId,
        parsed.data.severity,
        parsed.data.enforcementAction,
        new Date().toISOString()
      );
    } catch {
      res.status(409).json({ error: 'SoD policy name already exists' });
      return;
    }
    recordAuditEvent(db, {
      actor: req.user!.username,
      targetIdentity: id,
      action: `Catalog Admin Created SoD Policy: ${parsed.data.name}`,
      category: 'rbac_sod',
      newState: parsed.data,
      outcome: 'Success',
    });
    res.status(201).json({ policy: db.prepare('SELECT * FROM sod_policies WHERE id = ?').get(id) });
  });

  router.delete('/api/catalog/sod-policies/:id', requireAuth, requireRole('iam_admin'), (req, res) => {
    db.prepare('DELETE FROM sod_policies WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  router.post('/api/rbac/check-sod', requireAuth, (req, res) => {
    const { identityId, entitlementId } = req.body || {};
    if (!identityId || !entitlementId) {
      res.status(400).json({ error: 'identityId and entitlementId are required' });
      return;
    }
    res.json(evaluateSodForIdentity(db, identityId, entitlementId));
  });

  // --- ACCESS REQUESTS ---
  router.get('/api/requests', requireAuth, (_req, res) => {
    const rows = db
      .prepare(
        `SELECT ar.*, i.full_name AS target_name, i.email AS target_email, i.employee_id,
                a.name AS app_name, e.name AS ent_name, e.sensitivity
         FROM access_requests ar
         JOIN identities i ON i.id = ar.target_identity_id
         JOIN applications a ON a.id = ar.application_id
         JOIN entitlements e ON e.id = ar.entitlement_id
         ORDER BY ar.created_at DESC`
      )
      .all();
    res.json({ requests: rows });
  });

  router.get('/api/requests/:id', requireAuth, (req, res) => {
    const request = db
      .prepare(
        `SELECT ar.*, i.full_name AS target_name, i.email AS target_email, i.employee_id,
                a.name AS app_name, e.name AS ent_name, e.sensitivity
         FROM access_requests ar
         JOIN identities i ON i.id = ar.target_identity_id
         JOIN applications a ON a.id = ar.application_id
         JOIN entitlements e ON e.id = ar.entitlement_id
         WHERE ar.id = ?`
      )
      .get(req.params.id);
    if (!request) {
      res.status(404).json({ error: 'Access request not found' });
      return;
    }
    const approvals = db
      .prepare('SELECT * FROM approval_records WHERE access_request_id = ? ORDER BY rowid ASC')
      .all(req.params.id);
    const workItems = db
      .prepare('SELECT * FROM provisioning_work_items WHERE access_request_id = ?')
      .all(req.params.id);
    res.json({ request, approvals, workItems });
  });

  router.post('/api/requests', requireAuth, async (req, res) => {
    const parsed = z
      .object({
        targetIdentityId: z.string().min(1),
        applicationId: z.string().min(1),
        entitlementId: z.string().min(1),
        requestType: z.string().default('New Access'),
        businessJustification: z.string().min(5),
        priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid access request payload' });
      return;
    }

    const result = await createAccessRequest(db, config, {
      ...parsed.data,
      requestor: req.user!.email,
      actor: req.user!.username,
    });
    res.status(result.status).json(result);
  });

  router.post(
    '/api/requests/:id/decide',
    requireAuth,
    requireRole('iam_admin', 'iam_analyst', 'manager', 'app_owner'),
    async (req, res) => {
      const parsed = z
        .object({
          decision: z.enum(['Approved', 'Rejected']),
          comments: z.string().default(''),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Valid decision (Approved|Rejected) is required' });
        return;
      }
      const result = await decideAccessRequestStage(
        db,
        config,
        req.params.id,
        parsed.data.decision,
        parsed.data.comments,
        req.user!.full_name
      );
      res.status(result.status).json(result);
    }
  );

  // --- PROVISIONING QUEUE & LIVE DIRECTORY ---
  router.get('/api/provisioning/work-items', requireAuth, (_req, res) => {
    const items = db
      .prepare(
        `SELECT w.*, i.full_name AS target_name, i.email AS target_email, i.employee_id,
                a.name AS app_name, e.name AS ent_name
         FROM provisioning_work_items w
         JOIN identities i ON i.id = w.identity_id
         LEFT JOIN applications a ON a.id = w.application_id
         LEFT JOIN entitlements e ON e.id = w.entitlement_id
         ORDER BY w.created_at DESC`
      )
      .all();
    res.json({ workItems: items });
  });

  router.post(
    '/api/provisioning/work-items/:id/execute',
    requireAuth,
    requireRole('iam_admin', 'iam_analyst'),
    async (req, res) => {
      const result = await processWorkItem(db, config, req.params.id, req.user!.username);
      res.status(result.status).json(result);
    }
  );

  router.post(
    '/api/provisioning/work-items/:id/escalate',
    requireAuth,
    requireRole('iam_admin', 'iam_analyst'),
    (req, res) => {
      const item = db
        .prepare('SELECT * FROM provisioning_work_items WHERE id = ?')
        .get(req.params.id) as { id: string; work_item_number: string; identity_id: string } | undefined;
      if (!item) {
        res.status(404).json({ error: 'Work item not found' });
        return;
      }
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE provisioning_work_items SET escalated_to_l2 = 1, resolution_notes = ?, updated_at = ? WHERE id = ?`
      ).run(req.body?.notes || 'Manually escalated to Level 2 IAM Engineering', now, item.id);
      recordAuditEvent(db, {
        actor: req.user!.username,
        targetIdentity: item.identity_id,
        action: `Work Item Escalated to L2 (${item.work_item_number})`,
        category: 'provisioning',
        relatedId: item.work_item_number,
        outcome: 'Warning',
      });
      res.json({ workItem: db.prepare('SELECT * FROM provisioning_work_items WHERE id = ?').get(item.id) });
    }
  );

  router.get('/api/directory/live', requireAuth, (_req, res) => {
    const idpAccounts = db
      .prepare(
        `SELECT idp.*, i.full_name, i.employee_id, i.lifecycle_status
         FROM idp_accounts idp
         JOIN identities i ON i.id = idp.identity_id
         ORDER BY i.employee_id ASC`
      )
      .all();
    const ldapEntries = db
      .prepare(
        `SELECT l.*, i.employee_id, i.lifecycle_status
         FROM ldap_entries l
         JOIN identities i ON i.id = l.identity_id
         ORDER BY i.employee_id ASC`
      )
      .all();
    res.json({ idpAccounts, ldapEntries });
  });

  // --- SERVICENOW-STYLE ITSM TICKETS ---
  router.get('/api/tickets', requireAuth, (_req, res) => {
    const tickets = db.prepare('SELECT * FROM tickets ORDER BY created_at DESC').all();
    res.json({ tickets });
  });

  router.get('/api/tickets/:id', requireAuth, (req, res) => {
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    const comments = db
      .prepare('SELECT * FROM ticket_comments WHERE ticket_id = ? ORDER BY created_at ASC')
      .all(req.params.id);
    res.json({ ticket, comments });
  });

  router.post('/api/tickets', requireAuth, (req, res) => {
    const parsed = z
      .object({
        ticketType: z.enum(['Incident', 'Service Request', 'Operational Task']),
        title: z.string().min(3),
        description: z.string().min(5),
        category: z.string().min(2),
        priority: z.enum(['low', 'medium', 'high', 'critical']),
        assignedAnalyst: z.string().default('Marcus Chen'),
        linkedRequestId: z.string().nullable().optional(),
        linkedWorkItemId: z.string().nullable().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid ticket payload' });
      return;
    }
    const now = new Date().toISOString();
    const id = `TKT-${crypto.randomUUID().slice(0, 8)}`;
    const prefix =
      parsed.data.ticketType === 'Incident'
        ? 'INC'
        : parsed.data.ticketType === 'Service Request'
          ? 'SR'
          : 'TASK';
    const cnt = (db.prepare('SELECT COUNT(*) AS cnt FROM tickets').get() as { cnt: number }).cnt;
    const ticketNumber = `${prefix}-${1001 + cnt}`;

    db.prepare(
      `INSERT INTO tickets
        (id, ticket_number, ticket_type, requestor, assigned_analyst, title, description, category,
         priority, status, linked_request_id, linked_work_item_id, sla_deadline, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Open', ?, ?, ?, ?, ?)`
    ).run(
      id,
      ticketNumber,
      parsed.data.ticketType,
      req.user!.full_name,
      parsed.data.assignedAnalyst,
      parsed.data.title,
      parsed.data.description,
      parsed.data.category,
      parsed.data.priority,
      parsed.data.linkedRequestId || null,
      parsed.data.linkedWorkItemId || null,
      computeSlaDeadline(parsed.data.priority),
      now,
      now
    );

    recordAuditEvent(db, {
      actor: req.user!.username,
      targetIdentity: ticketNumber,
      action: `ITSM Ticket Created (${ticketNumber}): ${parsed.data.title}`,
      category: 'ticket',
      relatedId: ticketNumber,
      outcome: 'Success',
    });

    res.status(201).json({ ticket: db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) });
  });

  router.patch('/api/tickets/:id', requireAuth, requireRole('iam_admin', 'iam_analyst'), (req, res) => {
    const existing = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    const now = new Date().toISOString();
    const nextStatus = req.body?.status || existing.status;
    const nextAnalyst = req.body?.assignedAnalyst || existing.assigned_analyst;
    const resolutionNotes =
      req.body?.resolutionNotes !== undefined ? req.body.resolutionNotes : existing.resolution_notes;
    const resolvedAt =
      nextStatus === 'Resolved' || nextStatus === 'Closed'
        ? (existing.resolved_at as string | null) || now
        : null;

    db.prepare(
      `UPDATE tickets SET status = ?, assigned_analyst = ?, resolution_notes = ?, resolved_at = ?, updated_at = ? WHERE id = ?`
    ).run(nextStatus, nextAnalyst, resolutionNotes, resolvedAt, now, req.params.id);

    recordAuditEvent(db, {
      actor: req.user!.username,
      targetIdentity: String(existing.ticket_number),
      action: `ITSM Ticket Updated (${existing.ticket_number}): Status -> ${nextStatus}`,
      category: 'ticket',
      previousState: { status: existing.status },
      newState: { status: nextStatus, assignedAnalyst: nextAnalyst },
      relatedId: String(existing.ticket_number),
      outcome: 'Success',
    });

    res.json({ ticket: db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id) });
  });

  router.post('/api/tickets/:id/comments', requireAuth, (req, res) => {
    const body = String(req.body?.body || '').trim();
    if (!body) {
      res.status(400).json({ error: 'Comment body is required' });
      return;
    }
    const now = new Date().toISOString();
    db.prepare('INSERT INTO ticket_comments (id, ticket_id, author, body, created_at) VALUES (?, ?, ?, ?, ?)').run(
      `CMT-${crypto.randomUUID().slice(0, 8)}`,
      req.params.id,
      req.user!.full_name,
      body,
      now
    );
    db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(now, req.params.id);
    res.status(201).json({
      comments: db
        .prepare('SELECT * FROM ticket_comments WHERE ticket_id = ? ORDER BY created_at ASC')
        .all(req.params.id),
    });
  });

  router.post('/api/tickets/:id/escalate', requireAuth, requireRole('iam_admin', 'iam_analyst'), (req, res) => {
    const existing = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id) as
      | { id: string; ticket_number: string; escalation_level: number; escalation_history: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    const now = new Date().toISOString();
    const nextLevel = existing.escalation_level + 1;
    const hist = JSON.parse(existing.escalation_history || '[]') as Array<unknown>;
    hist.push({
      at: now,
      level: nextLevel,
      by: req.user!.full_name,
      reason: req.body?.reason || 'Manual escalation due to operational priority',
    });
    db.prepare(
      `UPDATE tickets SET status = 'Escalated', escalation_level = ?, escalation_history = ?, updated_at = ? WHERE id = ?`
    ).run(nextLevel, JSON.stringify(hist), now, existing.id);

    recordAuditEvent(db, {
      actor: req.user!.username,
      targetIdentity: existing.ticket_number,
      action: `ITSM Ticket Escalated to Level ${nextLevel} (${existing.ticket_number})`,
      category: 'ticket',
      relatedId: existing.ticket_number,
      outcome: 'Warning',
    });

    res.json({ ticket: db.prepare('SELECT * FROM tickets WHERE id = ?').get(existing.id) });
  });

  // --- ACCESS CERTIFICATION ---
  router.get('/api/certifications', requireAuth, (_req, res) => {
    const campaigns = db.prepare('SELECT * FROM certification_campaigns ORDER BY created_at DESC').all();
    const items = db
      .prepare(
        `SELECT ci.*, i.full_name AS identity_name, i.email AS identity_email, i.department,
                a.name AS app_name, e.name AS ent_name, e.sensitivity
         FROM certification_items ci
         JOIN identities i ON i.id = ci.identity_id
         JOIN applications a ON a.id = ci.application_id
         JOIN entitlements e ON e.id = ci.entitlement_id
         ORDER BY ci.decision = 'Pending' DESC, ci.is_overdue DESC`
      )
      .all();
    res.json({ campaigns, items });
  });

  router.post(
    '/api/certifications/campaigns',
    requireAuth,
    requireRole('iam_admin', 'auditor', 'manager'),
    (req, res) => {
      const parsed = z
        .object({
          name: z.string().min(3),
          description: z.string().min(5),
          scope: z.enum(['all_active', 'high_critical']),
          dueDays: z.number().int().min(1).max(90).default(14),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid campaign payload' });
        return;
      }
      const now = new Date();
      const due = new Date(now.getTime() + parsed.data.dueDays * 86400_000).toISOString();
      const campId = `CERT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

      db.prepare(
        `INSERT INTO certification_campaigns (id, name, description, scope, status, due_date, created_by, created_at)
         VALUES (?, ?, ?, ?, 'Active', ?, ?, ?)`
      ).run(
        campId,
        parsed.data.name,
        parsed.data.description,
        parsed.data.scope === 'high_critical' ? 'High & Critical Entitlements' : 'All Active Entitlements',
        due,
        req.user!.full_name,
        now.toISOString()
      );

      const query =
        parsed.data.scope === 'high_critical'
          ? `SELECT ie.identity_id, e.application_id, ie.entitlement_id, COALESCE(m.full_name, a.owner_name) AS reviewer
             FROM identity_entitlements ie
             JOIN entitlements e ON e.id = ie.entitlement_id
             JOIN applications a ON a.id = e.application_id
             JOIN identities i ON i.id = ie.identity_id
             LEFT JOIN identities m ON m.id = i.manager_id
             WHERE ie.status = 'Active' AND e.sensitivity IN ('high', 'critical')`
          : `SELECT ie.identity_id, e.application_id, ie.entitlement_id, COALESCE(m.full_name, a.owner_name) AS reviewer
             FROM identity_entitlements ie
             JOIN entitlements e ON e.id = ie.entitlement_id
             JOIN applications a ON a.id = e.application_id
             JOIN identities i ON i.id = ie.identity_id
             LEFT JOIN identities m ON m.id = i.manager_id
             WHERE ie.status = 'Active'`;

      const rows = db.prepare(query).all() as Array<{
        identity_id: string;
        application_id: string;
        entitlement_id: string;
        reviewer: string;
      }>;

      for (const row of rows) {
        db.prepare(
          `INSERT INTO certification_items
            (id, campaign_id, identity_id, application_id, entitlement_id, reviewer_name, decision, due_date)
           VALUES (?, ?, ?, ?, ?, ?, 'Pending', ?)`
        ).run(
          `CI-${crypto.randomUUID().slice(0, 8)}`,
          campId,
          row.identity_id,
          row.application_id,
          row.entitlement_id,
          row.reviewer,
          due
        );
      }

      recordAuditEvent(db, {
        actor: req.user!.username,
        targetIdentity: campId,
        action: `Access Certification Campaign Created (${parsed.data.name}) with ${rows.length} review items`,
        category: 'certification',
        relatedId: campId,
        outcome: 'Success',
      });

      res.status(201).json({
        campaign: db.prepare('SELECT * FROM certification_campaigns WHERE id = ?').get(campId),
        itemsCreated: rows.length,
      });
    }
  );

  router.post(
    '/api/certifications/items/:id/decide',
    requireAuth,
    requireRole('iam_admin', 'manager', 'app_owner', 'auditor'),
    async (req, res) => {
      const parsed = z
        .object({
          decision: z.enum(['Certified', 'Revoked', 'Investigate', 'Inappropriate']),
          justification: z.string().min(3),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Decision and review justification (>= 3 chars) are required' });
        return;
      }
      const item = db
        .prepare(
          `SELECT ci.*, i.email AS identity_email, e.name AS ent_name
           FROM certification_items ci
           JOIN identities i ON i.id = ci.identity_id
           JOIN entitlements e ON e.id = ci.entitlement_id
           WHERE ci.id = ?`
        )
        .get(req.params.id) as
        | {
            id: string;
            identity_id: string;
            application_id: string;
            entitlement_id: string;
            identity_email: string;
            ent_name: string;
          }
        | undefined;
      if (!item) {
        res.status(404).json({ error: 'Certification item not found' });
        return;
      }

      const now = new Date().toISOString();
      db.prepare(
        `UPDATE certification_items SET decision = ?, justification = ?, decided_by = ?, decided_at = ? WHERE id = ?`
      ).run(parsed.data.decision, parsed.data.justification, req.user!.full_name, now, item.id);

      // Revoke or Inappropriate triggers real deprovisioning work item!
      if (parsed.data.decision === 'Revoked' || parsed.data.decision === 'Inappropriate') {
        const wiId = `WI-${crypto.randomUUID().slice(0, 8)}`;
        const cnt = (
          db.prepare('SELECT COUNT(*) AS cnt FROM provisioning_work_items').get() as { cnt: number }
        ).cnt;
        const wiNum = `WI-${1001 + cnt}`;
        db.prepare(
          `INSERT INTO provisioning_work_items
            (id, work_item_number, idempotency_key, identity_id, application_id, entitlement_id,
             action, target_connector, priority, status, sla_deadline, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'revoke_entitlement', 'Keycloak IdP + App Adapter', 'high', 'Queued', ?, ?, ?)`
        ).run(
          wiId,
          wiNum,
          `CERT-REVOKE:${item.id}:${now}`,
          item.identity_id,
          item.application_id,
          item.entitlement_id,
          computeSlaDeadline('high'),
          now,
          now
        );
        await processWorkItem(db, config, wiId, 'Certification Enforcement');
      }

      recordAuditEvent(db, {
        actor: req.user!.username,
        targetIdentity: item.identity_email,
        action: `Access Certification Decision (${parsed.data.decision}): ${item.ent_name}`,
        category: 'certification',
        newState: { decision: parsed.data.decision, justification: parsed.data.justification },
        relatedId: item.id,
        outcome: 'Success',
      });

      res.json({ item: db.prepare('SELECT * FROM certification_items WHERE id = ?').get(item.id) });
    }
  );

  // --- AUDIT & COMPLIANCE ---
  router.get('/api/audit/events', requireAuth, (req, res) => {
    const search = String(req.query.search || '').trim().toLowerCase();
    const category = String(req.query.category || '').trim();
    const outcome = String(req.query.outcome || '').trim();

    let events = db
      .prepare('SELECT * FROM audit_events ORDER BY seq DESC LIMIT 250')
      .all() as Array<Record<string, unknown>>;

    if (search) {
      events = events.filter(
        (e) =>
          String(e.actor).toLowerCase().includes(search) ||
          String(e.target_identity).toLowerCase().includes(search) ||
          String(e.action).toLowerCase().includes(search) ||
          String(e.related_id || '').toLowerCase().includes(search)
      );
    }
    if (category && category !== 'All') {
      events = events.filter((e) => e.category === category);
    }
    if (outcome && outcome !== 'All') {
      events = events.filter((e) => e.outcome === outcome);
    }

    res.json({ events });
  });

  router.get('/api/audit/verify', requireAuth, (_req, res) => {
    res.json(verifyAuditChain(db));
  });

  router.get('/api/audit/export/:type', requireAuth, (req, res) => {
    const type = req.params.type;
    let csv = '';
    if (type === 'audit') {
      const rows = db.prepare('SELECT * FROM audit_events ORDER BY seq DESC').all() as Array<
        Record<string, unknown>
      >;
      csv = toCsv(
        ['seq', 'id', 'timestamp', 'actor', 'target_identity', 'category', 'action', 'related_id', 'outcome', 'event_hash'],
        rows
      );
    } else if (type === 'access_reviews') {
      const rows = db
        .prepare(
          `SELECT ci.id, cc.name AS campaign, i.employee_id, i.full_name, a.name AS application,
                  e.name AS entitlement, ci.reviewer_name, ci.decision, ci.justification, ci.decided_by, ci.decided_at
           FROM certification_items ci
           JOIN certification_campaigns cc ON cc.id = ci.campaign_id
           JOIN identities i ON i.id = ci.identity_id
           JOIN applications a ON a.id = ci.application_id
           JOIN entitlements e ON e.id = ci.entitlement_id`
        )
        .all() as Array<Record<string, unknown>>;
      csv = toCsv(
        ['id', 'campaign', 'employee_id', 'full_name', 'application', 'entitlement', 'reviewer_name', 'decision', 'justification', 'decided_by', 'decided_at'],
        rows
      );
    } else if (type === 'failed_provisioning') {
      const rows = db
        .prepare(
          `SELECT w.work_item_number, i.employee_id, i.full_name, a.name AS application, w.action,
                  w.status, w.retry_count, w.escalated_to_l2, w.error_details, w.created_at
           FROM provisioning_work_items w
           JOIN identities i ON i.id = w.identity_id
           LEFT JOIN applications a ON a.id = w.application_id
           WHERE w.status = 'Failed'`
        )
        .all() as Array<Record<string, unknown>>;
      csv = toCsv(
        ['work_item_number', 'employee_id', 'full_name', 'application', 'action', 'status', 'retry_count', 'escalated_to_l2', 'error_details', 'created_at'],
        rows
      );
    } else if (type === 'sod_violations') {
      const rows = db
        .prepare(
          `SELECT sv.id, sp.name AS policy_name, sp.severity, i.employee_id, i.full_name, sv.status, sv.detected_at, sv.mitigation_notes
           FROM sod_violations sv
           JOIN sod_policies sp ON sp.id = sv.policy_id
           JOIN identities i ON i.id = sv.identity_id`
        )
        .all() as Array<Record<string, unknown>>;
      csv = toCsv(
        ['id', 'policy_name', 'severity', 'employee_id', 'full_name', 'status', 'detected_at', 'mitigation_notes'],
        rows
      );
    } else {
      res.status(400).json({ error: 'Unknown export report type' });
      return;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="meridian-iamops-${type}.csv"`);
    res.send(csv);
  });

  // --- SYSTEM OPERATORS & DOCS ---
  router.get('/api/system/operators', requireAuth, requireRole('iam_admin'), (_req, res) => {
    const operators = db
      .prepare(
        `SELECT id, username, email, full_name, operator_role, mfa_enabled, failed_attempts, locked_until, is_active, last_login_at, created_at
         FROM operator_accounts ORDER BY operator_role ASC`
      )
      .all();
    res.json({ operators });
  });

  router.get('/api/system/dummy-data', requireAuth, (_req, res) => {
    const data = readDummyDataFile();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="dummy-data.json"');
    res.send(JSON.stringify(data, null, 2));
  });

  router.post('/api/system/load-dummy-data', requireAuth, requireRole('iam_admin'), (req, res) => {
    try {
      const customPayload =
        req.body && typeof req.body === 'object' && Array.isArray(req.body.applications)
          ? req.body
          : undefined;
      loadDummyDataFromFile(db, config, req.user!.username, customPayload);
      res.json({
        ok: true,
        message: customPayload
          ? 'Custom dummy dataset imported successfully.'
          : 'Loaded data/dummy-data.json into IAMOps database.',
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to load dummy data',
      });
    }
  });

  router.post('/api/system/clear-data', requireAuth, requireRole('iam_admin'), (req, res) => {
    clearAllOperationalData(db, config);
    if (config.env === 'prod') {
      recordAuditEvent(db, {
        actor: req.user!.username,
        targetIdentity: 'ALL_OPERATIONAL_TABLES',
        action: 'Cleared operational and catalog tables',
        category: 'security',
        outcome: 'Warning',
      });
    }
    res.json({ ok: true, message: 'All operational and catalog data cleared to zero.' });
  });

  const DOC_FILES = [
    'README.md',
    'ARCHITECTURE.md',
    'IAM_CONCEPTS.md',
    'JML_WORKFLOWS.md',
    'RBAC_AND_SOD.md',
    'PROVISIONING_GUIDE.md',
    'SERVICE_DESK_WORKFLOWS.md',
    'SECURITY_CONTROLS.md',
    'TESTING.md',
    'KNOWN_LIMITATIONS.md',
    'docs/DEPLOYMENT.md',
  ];

  router.get('/api/docs/list', requireAuth, (_req, res) => {
    res.json({
      docs: DOC_FILES.filter((f) => fs.existsSync(path.resolve(process.cwd(), f))),
    });
  });

  router.get('/api/docs/content', requireAuth, (req, res) => {
    const file = String(req.query.file || '');
    if (!DOC_FILES.includes(file)) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    const fullPath = path.resolve(process.cwd(), file);
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'Document not yet generated on disk' });
      return;
    }
    res.json({ file, content: fs.readFileSync(fullPath, 'utf8') });
  });

  return router;
}

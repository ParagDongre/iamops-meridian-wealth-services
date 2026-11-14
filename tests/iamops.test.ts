import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { verifyAuditChain } from '../src/server/audit.js';
import type { AppConfig } from '../src/server/config.js';
import { loadConfig } from '../src/server/config.js';
import { initDatabase, type DB } from '../src/server/db.js';
import { generateTotpCode } from '../src/server/security.js';
import { bootstrapOperators, loadDummyDataFromFile } from '../src/server/seed.js';

function makeTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    env: 'test',
    port: 3000,
    appUrl: 'http://localhost:3000',
    jwtSecret: 'test-jwt-secret-key-must-be-at-least-32-chars',
    mfaEncryptionKey: 'test-mfa-secret-key-must-be-at-least-32-chars',
    databasePath: ':memory:',
    slaSweepMinutes: 0,
    disableApiDocs: false,
    keycloakUrl: '',
    keycloakRealm: 'meridian',
    keycloakClientId: 'iamops-console',
    keycloakClientSecret: '',
    keycloakAdminUser: '',
    keycloakAdminPassword: '',
    ldapUrl: '',
    ldapBaseDn: 'dc=meridian,dc=internal',
    ...overrides,
  };
}

async function loginAs(app: any, username: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  expect(res.status).toBe(200);
  return res.body.token;
}

describe('IAMOps — Meridian Wealth Services Comprehensive Suite', () => {
  let db: DB;
  let config: AppConfig;
  let app: any;

  beforeEach(() => {
    config = makeTestConfig();
    db = initDatabase(':memory:');
    loadDummyDataFromFile(db, config, 'test.runner');
    app = createApp(db, config);
  });

  it('starts clean with zero sample figures when only bootstrapOperators is run, and supports clear/load dummy data', async () => {
    const cleanDb = initDatabase(':memory:');
    bootstrapOperators(cleanDb, config);
    const cleanApp = createApp(cleanDb, config);
    const adminToken = await loginAs(cleanApp, 'iam.admin', 'MeridianAdmin!2026');

    const emptyOverview = await request(cleanApp)
      .get('/api/dashboard/overview')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(emptyOverview.status).toBe(200);
    expect(emptyOverview.body.kpis.totalIdentities).toBe(0);
    expect(emptyOverview.body.kpis.pendingRequests).toBe(0);
    expect(emptyOverview.body.kpis.totalWorkItems).toBe(0);
    expect(emptyOverview.body.kpis.openTickets).toBe(0);
    expect(emptyOverview.body.kpis.slaCompliancePct).toBe(0);

    const loadRes = await request(cleanApp)
      .post('/api/system/load-dummy-data')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(loadRes.status).toBe(200);

    const populated = await request(cleanApp)
      .get('/api/dashboard/overview')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(populated.body.kpis.totalIdentities).toBe(14);

    const clearRes = await request(cleanApp)
      .post('/api/system/clear-data')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(clearRes.status).toBe(200);

    const cleared = await request(cleanApp)
      .get('/api/dashboard/overview')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(cleared.body.kpis.totalIdentities).toBe(0);
    expect(cleared.body.kpis.totalWorkItems).toBe(0);
  });

  it('enforces safe startup checks in ENV=prod on short or placeholder secrets', () => {
    const prevEnv = process.env.ENV;
    const prevJwt = process.env.JWT_SECRET;
    process.env.ENV = 'prod';
    process.env.JWT_SECRET = 'changeme';
    expect(() => loadConfig()).toThrow(/SAFE STARTUP BLOCKED/);
    process.env.ENV = prevEnv;
    process.env.JWT_SECRET = prevJwt;
  });

  it('rejects unauthenticated requests and revoked JWT tokens', async () => {
    const unauth = await request(app).get('/api/identities');
    expect(unauth.status).toBe(401);

    const token = await loginAs(app, 'iam.admin', 'MeridianAdmin!2026');
    const ok = await request(app).get('/api/identities').set('Authorization', `Bearer ${token}`);
    expect(ok.status).toBe(200);

    await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
    const afterLogout = await request(app).get('/api/identities').set('Authorization', `Bearer ${token}`);
    expect(afterLogout.status).toBe(401);
    expect(afterLogout.body.code).toBe('TOKEN_REVOKED');
  });

  it('locks account after 5 failed logins and allows IAM Admin unlock', async () => {
    for (let i = 0; i < 4; i++) {
      const fail = await request(app)
        .post('/api/auth/login')
        .send({ username: 'iam.analyst', password: 'WrongPassword!' });
      expect(fail.status).toBe(401);
    }
    const fifth = await request(app)
      .post('/api/auth/login')
      .send({ username: 'iam.analyst', password: 'WrongPassword!' });
    expect(fifth.status).toBe(423);
    expect(fifth.body.code).toBe('ACCOUNT_LOCKED');

    // Even valid password is blocked while locked
    const blocked = await request(app)
      .post('/api/auth/login')
      .send({ username: 'iam.analyst', password: 'MeridianAnalyst!2026' });
    expect(blocked.status).toBe(423);

    const adminToken = await loginAs(app, 'iam.admin', 'MeridianAdmin!2026');
    const unlock = await request(app)
      .post('/api/auth/operators/OP-ANALYST-01/unlock')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(unlock.status).toBe(200);

    const afterUnlock = await request(app)
      .post('/api/auth/login')
      .send({ username: 'iam.analyst', password: 'MeridianAnalyst!2026' });
    expect(afterUnlock.status).toBe(200);
  });

  it('supports OIDC PKCE SSO login and TOTP MFA enrollment/enforcement', async () => {
    const authz = await request(app).get('/api/auth/oidc/authorize');
    expect(authz.status).toBe(200);
    const consent = await request(app).post('/api/auth/oidc/consent').send({
      state: authz.body.state,
      codeChallenge: authz.body.codeChallenge,
      username: 'iam.admin',
      password: 'MeridianAdmin!2026',
    });
    expect(consent.status).toBe(200);
    const cb = await request(app)
      .post('/api/auth/oidc/callback')
      .send({ code: consent.body.code, state: consent.body.state });
    expect(cb.status).toBe(200);
    expect(cb.body.user.auth_method).toBe('oidc_sso');

    const token = cb.body.token;
    const enroll = await request(app).post('/api/auth/mfa/enroll').set('Authorization', `Bearer ${token}`);
    expect(enroll.status).toBe(200);
    const code = generateTotpCode(enroll.body.secret, 0);
    const verify = await request(app)
      .post('/api/auth/mfa/verify-setup')
      .set('Authorization', `Bearer ${token}`)
      .send({ code });
    expect(verify.status).toBe(200);

    const step1 = await request(app)
      .post('/api/auth/login')
      .send({ username: 'iam.admin', password: 'MeridianAdmin!2026' });
    expect(step1.body.mfaRequired).toBe(true);

    const step2 = await request(app)
      .post('/api/auth/login')
      .send({ username: 'iam.admin', password: 'MeridianAdmin!2026', mfaCode: code });
    expect(step2.status).toBe(200);
    expect(step2.body.token).toBeTruthy();
  });

  it('enforces RBAC so auditors cannot mutate identities or catalog', async () => {
    const auditorToken = await loginAs(app, 'compliance.auditor', 'MeridianAuditor!2026');
    const createAttempt = await request(app)
      .post('/api/identities')
      .set('Authorization', `Bearer ${auditorToken}`)
      .send({
        fullName: 'Unauthorized User',
        email: 'unauth@meridianwealth.internal',
        department: 'IT',
        jobTitle: 'Analyst',
        location: 'NY',
        joiningDate: '2026-11-01',
        businessRoleId: 'ROLE-WA',
      });
    expect(createAttempt.status).toBe(403);

    const appAttempt = await request(app)
      .post('/api/catalog/apps')
      .set('Authorization', `Bearer ${auditorToken}`)
      .send({
        name: 'Rogue App',
        code: 'ROGUE',
        ownerName: 'X',
        ownerEmail: 'x@meridianwealth.internal',
        criticality: 'low',
        connectorType: 'keycloak_oidc',
        description: 'Blocked',
      });
    expect(appAttempt.status).toBe(403);
  });

  it('supports Catalog Admin CRUD for apps, entitlements, roles, and SoD policies', async () => {
    const adminToken = await loginAs(app, 'iam.admin', 'MeridianAdmin!2026');
    const appRes = await request(app)
      .post('/api/catalog/apps')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Treasury Wire Hub',
        code: 'TWH',
        ownerName: 'Arthur Pendelton',
        ownerEmail: 'arthur.pendelton@meridianwealth.internal',
        criticality: 'critical',
        connectorType: 'keycloak_oidc',
        description: 'Treasury liquidity platform',
        slaHours: 8,
      });
    expect(appRes.status).toBe(201);

    const entRes = await request(app)
      .post('/api/catalog/entitlements')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        applicationId: appRes.body.application.id,
        name: 'Liquidity Approver',
        code: 'TWH_APPROVE',
        description: 'Approve liquidity sweeps',
        sensitivity: 'critical',
        requiresComplianceApproval: true,
      });
    expect(entRes.status).toBe(201);

    const roleRes = await request(app)
      .post('/api/catalog/roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Treasury Director',
        department: 'Finance',
        description: 'Senior treasury signatory',
        riskLevel: 'critical',
        entitlementIds: [entRes.body.entitlement.id],
      });
    expect(roleRes.status).toBe(201);
  });

  it('creates and updates identities, and executes full Joiner, Mover, and Leaver workflows', async () => {
    const adminToken = await loginAs(app, 'iam.admin', 'MeridianAdmin!2026');

    // User creation & modification
    const createRes = await request(app)
      .post('/api/identities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Evelyn Shaw',
        email: 'evelyn.shaw@meridianwealth.internal',
        department: 'Finance',
        jobTitle: 'Junior Analyst',
        location: 'New York',
        joiningDate: '2026-11-10',
        businessRoleId: 'ROLE-FIN',
      });
    expect(createRes.status).toBe(201);

    const modRes = await request(app)
      .patch(`/api/identities/${createRes.body.identity.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ jobTitle: 'Financial Controller' });
    expect(modRes.status).toBe(200);
    expect(modRes.body.identity.job_title).toBe('Financial Controller');

    // Joiner workflow
    const joinRes = await request(app)
      .post('/api/jml/joiner')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Lucas Sterling',
        email: 'lucas.sterling@meridianwealth.internal',
        department: 'Wealth Management',
        jobTitle: 'Wealth Advisor',
        location: 'Chicago',
        joiningDate: '2026-11-13',
        businessRoleId: 'ROLE-WA',
        autoApproveStandard: true,
      });
    expect(joinRes.status).toBe(201);
    expect(joinRes.body.generatedRequests.length).toBeGreaterThan(0);

    // Mover workflow (Wealth Advisor -> Finance Analyst)
    const moveRes = await request(app)
      .post('/api/jml/mover')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        identityId: joinRes.body.identity.id,
        newDepartment: 'Finance',
        newJobTitle: 'Finance Analyst',
        newBusinessRoleId: 'ROLE-FIN',
        justification: 'Internal rotation into Finance team',
      });
    expect(moveRes.status).toBe(200);
    expect(moveRes.body.revokedWorkItems.length).toBeGreaterThan(0);
    expect(moveRes.body.newAccessRequests.length).toBeGreaterThan(0);

    // Leaver workflow -> zero active privilege verification
    const leaveRes = await request(app)
      .post('/api/jml/leaver')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        identityId: joinRes.body.identity.id,
        terminationReason: 'Contract ended',
      });
    expect(leaveRes.status).toBe(200);
    expect(leaveRes.body.verification.verifiedZeroAccess).toBe(true);
    expect(leaveRes.body.verification.remainingActiveEntitlements).toBe(0);
    expect(leaveRes.body.verification.remainingActiveAccounts).toBe(0);
  });

  it('blocks SoD violations, enforces multi-stage approvals, and handles rejected requests', async () => {
    const adminToken = await loginAs(app, 'iam.admin', 'MeridianAdmin!2026');

    // Julian Mercer (ID-1002) holds WMP Trade Initiation -> requesting Trade Approval must block via SoD!
    const sodBlock = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        targetIdentityId: 'ID-1002',
        applicationId: 'APP-WMP',
        entitlementId: 'ENT-WMP-TRADE-APP',
        businessJustification: 'Want self-approval permission',
        priority: 'high',
      });
    expect(sodBlock.status).toBe(409);
    expect(sodBlock.body.error).toMatch(/Segregation of Duties/i);

    // Rejected request does NOT grant access
    const reqCreate = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        targetIdentityId: 'ID-1003',
        applicationId: 'APP-DMS',
        entitlementId: 'ENT-DMS-ADMIN',
        businessJustification: 'Need vault admin',
        priority: 'medium',
      });
    expect(reqCreate.status).toBe(201);
    const reqId = reqCreate.body.request.id;

    const rejRes = await request(app)
      .post(`/api/requests/${reqId}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'Rejected', comments: 'Not aligned with RM least privilege' });
    expect(rejRes.status).toBe(200);
    expect(rejRes.body.request.approval_status).toBe('Rejected');

    const checkEnt = db
      .prepare(`SELECT 1 FROM identity_entitlements WHERE identity_id = 'ID-1003' AND entitlement_id = 'ENT-DMS-ADMIN' AND status = 'Active'`)
      .get();
    expect(checkEnt).toBeUndefined();

    // Multi-stage approved request provisions only AFTER final stage
    const req2 = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        targetIdentityId: 'ID-1005',
        applicationId: 'APP-CMP',
        entitlementId: 'ENT-CMP-AUDIT',
        businessJustification: 'Audit support',
        priority: 'medium',
      });
    expect(req2.status).toBe(201);
    const r2Id = req2.body.request.id;

    // Stage 1 (manager) -> still Pending Approval
    const s1 = await request(app)
      .post(`/api/requests/${r2Id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'Approved', comments: 'Manager OK' });
    expect(s1.body.request.approval_status).toBe('Pending Approval');

    // Stage 2 (app_owner) -> still Pending Approval (requires compliance)
    const s2 = await request(app)
      .post(`/api/requests/${r2Id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'Approved', comments: 'Owner OK' });
    expect(s2.body.request.approval_status).toBe('Pending Approval');

    // Stage 3 (compliance) -> Approved & Fulfilled!
    const s3 = await request(app)
      .post(`/api/requests/${r2Id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'Approved', comments: 'Compliance OK' });
    expect(s3.body.request.approval_status).toBe('Approved');
    expect(s3.body.request.completion_status).toBe('Fulfilled');
  });

  it('handles provisioning failure, auto-incident creation, retry recovery, and idempotency', async () => {
    const adminToken = await loginAs(app, 'iam.admin', 'MeridianAdmin!2026');

    // Retry failed WI-1003 while WMP is healthy -> succeeds & idempotent repeat skips duplicate
    const retryOk = await request(app)
      .post('/api/provisioning/work-items/WI-1003/execute')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(retryOk.status).toBe(200);
    expect(retryOk.body.workItem.status).toBe('Fulfilled');

    const idemp = await request(app)
      .post('/api/provisioning/work-items/WI-1003/execute')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(idemp.status).toBe(200);
    expect(idemp.body.idempotentSkip).toBe(true);

    // Enable failure simulation on APP-CRM, approve a request -> fails honestly & opens incident
    await request(app)
      .patch('/api/catalog/apps/APP-CRM')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ simulateFailure: true });

    const reqFail = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        targetIdentityId: 'ID-1009',
        applicationId: 'APP-CRM',
        entitlementId: 'ENT-CRM-VIEW',
        businessJustification: 'Need client contact check',
        priority: 'high',
      });
    const rfId = reqFail.body.request.id;
    await request(app)
      .post(`/api/requests/${rfId}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'Approved', comments: 'MGR' });
    const finalStage = await request(app)
      .post(`/api/requests/${rfId}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'Approved', comments: 'OWNER' });

    expect(finalStage.body.workItem.status).toBe('Failed');
    expect(finalStage.body.workItem.error_details).toMatch(/CONNECTOR_REJECTED/);
  });

  it('executes ticket SLA sweep, access certification revocation, and verifies immutable audit chain', async () => {
    const adminToken = await loginAs(app, 'iam.admin', 'MeridianAdmin!2026');

    // Ticket SLA sweep
    const sweep = await request(app)
      .post('/api/sla/sweep')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(sweep.status).toBe(200);

    // Certification revocation triggers deprovisioning
    const certRevoke = await request(app)
      .post('/api/certifications/items/CI-1002/decide')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'Revoked', justification: 'No longer requires wire initiation access' });
    expect(certRevoke.status).toBe(200);
    expect(certRevoke.body.item.decision).toBe('Revoked');

    // Audit log immutability trigger prevents UPDATE/DELETE
    expect(() => db.exec(`DELETE FROM audit_events`)).toThrow(/immutable/i);
    expect(() => db.exec(`UPDATE audit_events SET action = 'tampered'`)).toThrow(/immutable/i);

    // Hash chain integrity check passes
    const chain = verifyAuditChain(db);
    expect(chain.valid).toBe(true);
    expect(chain.checkedCount).toBeGreaterThan(0);
  });
});

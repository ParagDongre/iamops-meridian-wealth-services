import crypto from 'node:crypto';
import type { AppConfig } from './config.js';
import type { DB } from './db.js';

export interface ConnectorResult {
  success: boolean;
  externalReference?: string;
  error?: string;
  targetSystem: 'Keycloak IdP' | 'OpenLDAP Directory' | 'Application Adapter';
}

export async function syncKeycloakIdentity(
  db: DB,
  config: AppConfig,
  identityId: string,
  action: 'upsert' | 'disable' | 'enable'
): Promise<ConnectorResult> {
  const identity = db
    .prepare('SELECT id, employee_id, full_name, email, department, business_role_id, lifecycle_status FROM identities WHERE id = ?')
    .get(identityId) as
    | {
        id: string;
        employee_id: string;
        full_name: string;
        email: string;
        department: string;
        business_role_id: string | null;
        lifecycle_status: string;
      }
    | undefined;

  if (!identity) {
    return { success: false, error: `Identity ${identityId} not found`, targetSystem: 'Keycloak IdP' };
  }

  const username = identity.email.split('@')[0].toLowerCase();
  const roleRow = identity.business_role_id
    ? (db.prepare('SELECT name FROM business_roles WHERE id = ?').get(identity.business_role_id) as
        | { name: string }
        | undefined)
    : undefined;

  const realmRoles =
    action === 'disable'
      ? []
      : ['meridian-employee', ...(roleRow ? [roleRow.name.toLowerCase().replace(/\s+/g, '-')] : [])];

  // If real Keycloak URL and admin credentials are supplied, call Keycloak Admin REST API
  if (config.keycloakUrl && config.keycloakAdminUser && config.keycloakAdminPassword) {
    try {
      const tokenRes = await fetch(
        `${config.keycloakUrl}/realms/master/protocol/openid-connect/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'password',
            client_id: 'admin-cli',
            username: config.keycloakAdminUser,
            password: config.keycloakAdminPassword,
          }),
        }
      );
      if (!tokenRes.ok) {
        return {
          success: false,
          error: `Keycloak admin auth failed (${tokenRes.status})`,
          targetSystem: 'Keycloak IdP',
        };
      }
      const tokenJson = (await tokenRes.json()) as { access_token: string };
      const usersUrl = `${config.keycloakUrl}/admin/realms/${config.keycloakRealm}/users`;
      const searchRes = await fetch(`${usersUrl}?username=${encodeURIComponent(username)}`, {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      });
      const existingUsers = (await searchRes.json()) as Array<{ id: string }>;
      const enabled = action !== 'disable';
      const [firstName, ...rest] = identity.full_name.split(' ');
      const lastName = rest.join(' ') || 'User';

      if (existingUsers.length > 0) {
        const kcId = existingUsers[0].id;
        await fetch(`${usersUrl}/${kcId}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${tokenJson.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ enabled, firstName, lastName, email: identity.email }),
        });
      } else if (action !== 'disable') {
        await fetch(usersUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenJson.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            username,
            enabled: true,
            firstName,
            lastName,
            email: identity.email,
            emailVerified: true,
          }),
        });
      }
    } catch (err) {
      return {
        success: false,
        error: `Keycloak network error: ${err instanceof Error ? err.message : String(err)}`,
        targetSystem: 'Keycloak IdP',
      };
    }
  }

  const now = new Date().toISOString();
  const existing = db
    .prepare('SELECT id, keycloak_user_id FROM idp_accounts WHERE identity_id = ?')
    .get(identity.id) as { id: string; keycloak_user_id: string } | undefined;

  const kcUserId = existing?.keycloak_user_id || `kc-${crypto.randomUUID().slice(0, 12)}`;
  const enabledInt = action === 'disable' ? 0 : 1;

  if (existing) {
    db.prepare(
      `UPDATE idp_accounts SET enabled = ?, realm_roles = ?, last_synced_at = ? WHERE identity_id = ?`
    ).run(enabledInt, JSON.stringify(realmRoles), now, identity.id);
  } else {
    db.prepare(
      `INSERT INTO idp_accounts (id, identity_id, keycloak_user_id, username, realm, enabled, realm_roles, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `IDP-${crypto.randomUUID().slice(0, 8)}`,
      identity.id,
      kcUserId,
      username,
      config.keycloakRealm,
      enabledInt,
      JSON.stringify(realmRoles),
      now
    );
  }

  return {
    success: true,
    externalReference: kcUserId,
    targetSystem: 'Keycloak IdP',
  };
}

export function syncOpenLdapEntry(
  db: DB,
  config: AppConfig,
  identityId: string,
  action: 'upsert' | 'lock' | 'unlock'
): ConnectorResult {
  const identity = db
    .prepare('SELECT id, full_name, email, department, job_title FROM identities WHERE id = ?')
    .get(identityId) as
    | { id: string; full_name: string; email: string; department: string; job_title: string }
    | undefined;

  if (!identity) {
    return { success: false, error: `Identity ${identityId} not found`, targetSystem: 'OpenLDAP Directory' };
  }

  const uid = identity.email.split('@')[0].toLowerCase();
  const ou = identity.department.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const dn = `uid=${uid},ou=${ou},ou=people,${config.ldapBaseDn}`;

  const memberships =
    action === 'lock'
      ? []
      : (db
          .prepare(
            `SELECT dg.dn FROM group_memberships gm
             JOIN directory_groups dg ON dg.id = gm.group_id
             WHERE gm.identity_id = ?`
          )
          .all(identityId) as Array<{ dn: string }>).map((r) => r.dn);

  const lockInt = action === 'lock' ? 1 : 0;
  const now = new Date().toISOString();

  const existing = db
    .prepare('SELECT id FROM ldap_entries WHERE identity_id = ?')
    .get(identityId) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE ldap_entries
       SET dn = ?, ou = ?, cn = ?, mail = ?, title = ?, member_of = ?, ns_account_lock = ?, last_synced_at = ?
       WHERE identity_id = ?`
    ).run(
      dn,
      ou,
      identity.full_name,
      identity.email,
      identity.job_title,
      JSON.stringify(memberships),
      lockInt,
      now,
      identityId
    );
  } else {
    db.prepare(
      `INSERT INTO ldap_entries (id, identity_id, dn, uid, ou, cn, mail, title, member_of, ns_account_lock, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `LDAP-${crypto.randomUUID().slice(0, 8)}`,
      identityId,
      dn,
      uid,
      ou,
      identity.full_name,
      identity.email,
      identity.job_title,
      JSON.stringify(memberships),
      lockInt,
      now
    );
  }

  return {
    success: true,
    externalReference: dn,
    targetSystem: 'OpenLDAP Directory',
  };
}

export async function executeConnectorAction(
  db: DB,
  config: AppConfig,
  workItem: {
    id: string;
    identity_id: string;
    application_id: string | null;
    entitlement_id: string | null;
    group_id: string | null;
    action: string;
    target_connector: string;
  }
): Promise<ConnectorResult> {
  if (workItem.application_id) {
    const app = db
      .prepare('SELECT id, name, code, simulate_failure, is_active FROM applications WHERE id = ?')
      .get(workItem.application_id) as
      | { id: string; name: string; code: string; simulate_failure: number; is_active: number }
      | undefined;

    if (!app) {
      return {
        success: false,
        error: `Target application ${workItem.application_id} missing from registry`,
        targetSystem: 'Application Adapter',
      };
    }

    if (app.simulate_failure === 1 && !workItem.action.includes('disable') && !workItem.action.includes('revoke')) {
      return {
        success: false,
        error: `CONNECTOR_REJECTED [${app.code}]: Downstream connector for ${app.name} returned 503 Service Unavailable (simulated connector outage / policy lock).`,
        targetSystem: 'Keycloak IdP',
      };
    }
  }

  const identity = db
    .prepare('SELECT id, email, lifecycle_status FROM identities WHERE id = ?')
    .get(workItem.identity_id) as
    | { id: string; email: string; lifecycle_status: string }
    | undefined;

  if (!identity) {
    return {
      success: false,
      error: `Target identity ${workItem.identity_id} does not exist`,
      targetSystem: 'Keycloak IdP',
    };
  }

  const now = new Date().toISOString();
  const username = identity.email.split('@')[0].toLowerCase();

  switch (workItem.action) {
    case 'create_account':
    case 'grant_entitlement': {
      if (identity.lifecycle_status === 'Disabled') {
        return {
          success: false,
          error: 'SAFEGUARD_BLOCKED: Cannot provision active application access for a Disabled/Terminated identity.',
          targetSystem: 'Application Adapter',
        };
      }
      if (workItem.application_id) {
        const existingAcct = db
          .prepare('SELECT id, external_account_id FROM app_accounts WHERE identity_id = ? AND application_id = ?')
          .get(workItem.identity_id, workItem.application_id) as
          | { id: string; external_account_id: string }
          | undefined;
        if (!existingAcct) {
          const extId = `EXT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
          db.prepare(
            `INSERT INTO app_accounts (id, identity_id, application_id, username, external_account_id, status, provisioned_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'Active', ?, ?)`
          ).run(
            `ACCT-${crypto.randomUUID().slice(0, 8)}`,
            workItem.identity_id,
            workItem.application_id,
            username,
            extId,
            now,
            now
          );
        } else {
          db.prepare(`UPDATE app_accounts SET status = 'Active', updated_at = ? WHERE id = ?`).run(
            now,
            existingAcct.id
          );
        }
      }
      if (workItem.entitlement_id) {
        const existingEnt = db
          .prepare('SELECT id FROM identity_entitlements WHERE identity_id = ? AND entitlement_id = ?')
          .get(workItem.identity_id, workItem.entitlement_id) as { id: string } | undefined;
        if (existingEnt) {
          db.prepare(
            `UPDATE identity_entitlements SET status = 'Active', revoked_at = NULL, granted_at = ? WHERE id = ?`
          ).run(now, existingEnt.id);
        } else {
          db.prepare(
            `INSERT INTO identity_entitlements (id, identity_id, entitlement_id, assignment_source, status, granted_at)
             VALUES (?, ?, ?, 'request', 'Active', ?)`
          ).run(
            `IE-${crypto.randomUUID().slice(0, 8)}`,
            workItem.identity_id,
            workItem.entitlement_id,
            now
          );
        }
      }
      await syncKeycloakIdentity(db, config, workItem.identity_id, 'upsert');
      syncOpenLdapEntry(db, config, workItem.identity_id, 'upsert');
      return {
        success: true,
        externalReference: `PROVISIONED:${username}`,
        targetSystem: 'Keycloak IdP',
      };
    }

    case 'revoke_entitlement': {
      if (workItem.entitlement_id) {
        db.prepare(
          `UPDATE identity_entitlements SET status = 'Revoked', revoked_at = ? WHERE identity_id = ? AND entitlement_id = ?`
        ).run(now, workItem.identity_id, workItem.entitlement_id);
      }
      if (workItem.application_id) {
        const remaining = db
          .prepare(
            `SELECT COUNT(*) AS cnt FROM identity_entitlements ie
             JOIN entitlements e ON e.id = ie.entitlement_id
             WHERE ie.identity_id = ? AND e.application_id = ? AND ie.status = 'Active'`
          )
          .get(workItem.identity_id, workItem.application_id) as { cnt: number };
        if (remaining.cnt === 0) {
          db.prepare(
            `UPDATE app_accounts SET status = 'Revoked', updated_at = ? WHERE identity_id = ? AND application_id = ?`
          ).run(now, workItem.identity_id, workItem.application_id);
        }
      }
      await syncKeycloakIdentity(db, config, workItem.identity_id, 'upsert');
      syncOpenLdapEntry(db, config, workItem.identity_id, 'upsert');
      return {
        success: true,
        externalReference: `REVOKED:${username}`,
        targetSystem: 'Application Adapter',
      };
    }

    case 'add_group': {
      if (workItem.group_id) {
        db.prepare(
          `INSERT OR IGNORE INTO group_memberships (id, identity_id, group_id, assigned_at) VALUES (?, ?, ?, ?)`
        ).run(`GM-${crypto.randomUUID().slice(0, 8)}`, workItem.identity_id, workItem.group_id, now);
      }
      syncOpenLdapEntry(db, config, workItem.identity_id, 'upsert');
      return {
        success: true,
        externalReference: `LDAP_GROUP_ADD:${username}`,
        targetSystem: 'OpenLDAP Directory',
      };
    }

    case 'remove_group': {
      if (workItem.group_id) {
        db.prepare(`DELETE FROM group_memberships WHERE identity_id = ? AND group_id = ?`).run(
          workItem.identity_id,
          workItem.group_id
        );
      }
      syncOpenLdapEntry(db, config, workItem.identity_id, 'upsert');
      return {
        success: true,
        externalReference: `LDAP_GROUP_REMOVE:${username}`,
        targetSystem: 'OpenLDAP Directory',
      };
    }

    case 'disable_account': {
      db.prepare(
        `UPDATE app_accounts SET status = 'Disabled', updated_at = ? WHERE identity_id = ?`
      ).run(now, workItem.identity_id);
      db.prepare(
        `UPDATE identity_entitlements SET status = 'Revoked', revoked_at = ? WHERE identity_id = ? AND status = 'Active'`
      ).run(now, workItem.identity_id);
      db.prepare(`DELETE FROM group_memberships WHERE identity_id = ?`).run(workItem.identity_id);
      await syncKeycloakIdentity(db, config, workItem.identity_id, 'disable');
      syncOpenLdapEntry(db, config, workItem.identity_id, 'lock');
      return {
        success: true,
        externalReference: `DISABLED_ALL:${username}`,
        targetSystem: 'Keycloak IdP',
      };
    }

    default:
      return {
        success: false,
        error: `Unsupported provisioning action: ${workItem.action}`,
        targetSystem: 'Application Adapter',
      };
  }
}

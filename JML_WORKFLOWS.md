# Joiner, Mover, Leaver (JML) Workflows

## 1. Joiner Workflow (`POST /api/jml/joiner`)
1. Creates authoritative `identities` record (`EMP-XXXX`, `Active`).
2. Provisions baseline Keycloak IdP (`idp_accounts`) and OpenLDAP (`ldap_entries`) entries.
3. Queries `role_entitlements` for the assigned Business Role.
4. Generates individual `access_requests` for each required entitlement and routes them through Manager -> App Owner -> Compliance approvals.

## 2. Mover Workflow (`POST /api/jml/mover`)
1. Updates `department`, `job_title`, `manager_id`, and `business_role_id`.
2. Diffs currently active `identity_entitlements` against the new Business Role's entitlement set.
3. Immediately enqueues and executes `revoke_entitlement` work items for excess permissions no longer required by the new role.
4. Submits new `access_requests` for newly required permissions (subject to SoD checks and approvals).
5. Updates OpenLDAP `ou` and `title` attributes and Keycloak realm roles.

## 3. Leaver Workflow (`POST /api/jml/leaver`)
1. Marks `employment_status = 'Terminated'` and `lifecycle_status = 'Disabled'`.
2. Automatically rejects/cancels all in-flight pending `access_requests` so post-termination approvals cannot grant access.
3. Executes a critical-priority `disable_account` work item:
   - Revokes all `identity_entitlements`
   - Disables all `app_accounts`
   - Removes all `group_memberships`
   - Sets Keycloak IdP `enabled = 0` and OpenLDAP `ns_account_lock = 1`
4. Runs a zero-privilege-retention verification query confirming `0` active entitlements, `0` active app accounts, and `0` group memberships remain.

# IAM Concepts (as implemented here)
- **Identity** = the person (`identities`). **Account** = their login in a target system (`accounts`: keycloak, ldap). **Role** = business role bundling entitlements. **Group** = directory collection. **Entitlement** = permission inside an application. **Assignment** = identity holds entitlement. Separate tables on purpose.
- **SailPoint-style concepts → this lab**: identity cube → `identities`+`assignments`; access request → `access_requests`+`approvals`; provisioning task → `work_items`; certification → `cert_campaigns`/`cert_items`; SoD policy → `sod_policies`. A simulation of the ideas; NO SailPoint integration.
- **Active Directory / LDAP**: LDAP is the protocol; a directory is a tree of entries (`uid=...,ou=people,dc=meridian,dc=local`). OpenLDAP is a real component; Active Directory itself is NOT used.
- **Keycloak**: real identity provider; accounts and groups are created via its Admin REST API.
- **ServiceNow-style tickets**: custom ITSM simulation, not ServiceNow.

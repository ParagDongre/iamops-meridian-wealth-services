# RBAC & Segregation of Duties (SoD)

## Business Roles & Least Privilege
Meridian Wealth Services enforces Role-Based Access Control across seven baseline roles:
- Wealth Advisor
- Relationship Manager
- Operations Analyst
- Compliance Analyst
- Finance Analyst
- System Administrator
- External Contractor

Console operators are likewise restricted via API-enforced RBAC middleware (`requireRole(...)`):
- `iam_admin`: Full Catalog Admin, operator unlocks, JML, requests, provisioning, tickets, certifications.
- `iam_analyst`: Identity CRUD, JML, provisioning execution, tickets, SLA sweeps.
- `manager` / `app_owner`: Approval stage decisions and access certification reviews.
- `auditor`: Read-only access across modules, certification campaign creation/reviews, audit verification, and CSV exports.

## Segregation of Duties Policies
Evaluated server-side in `evaluateSodForIdentity()` against both active entitlements and in-flight requests:
1. **Trade Initiation vs. Trade Approval Conflict**: Prevents an advisor from initiating and releasing their own trades.
2. **Wire Payment Initiation vs. Wire Approval Conflict**: Enforces four-eyes control on outbound wire transfers.
3. **Directory Provisioner vs. RBAC Policy Approver Conflict**: Separates account provisioning from RBAC policy approval.
4. **Trade Initiation vs. AML Surveillance Conflict**: Prevents active traders from clearing their own AML alerts.

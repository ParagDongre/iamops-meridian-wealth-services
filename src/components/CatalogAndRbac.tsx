import React, { useEffect, useState } from 'react';
import { Database, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { apiRequest, statusTextClass, type AuthUser } from '../types';

const createEmptyApp = () => ({
  name: '',
  code: '',
  ownerName: '',
  ownerEmail: '',
  criticality: 'medium',
  connectorType: 'keycloak_oidc',
  description: '',
  slaHours: 24,
});

const createEmptyEnt = (applicationId = '') => ({
  applicationId,
  name: '',
  code: '',
  description: '',
  sensitivity: 'standard',
  requiresComplianceApproval: false,
});

const createEmptyRole = () => ({
  name: '',
  department: 'Wealth Management',
  description: '',
  riskLevel: 'standard',
  entitlementIds: [] as string[],
});

const createEmptyGroup = (applicationId = '') => ({
  name: '',
  dn: '',
  description: '',
  applicationId,
});

const createEmptySod = (entitlementAId = '', entitlementBId = '') => ({
  name: '',
  description: '',
  entitlementAId,
  entitlementBId,
  severity: 'high',
  enforcementAction: 'block',
});

export const CatalogAndRbacModule: React.FC<{ user: AuthUser }> = ({ user }) => {
  const [catalog, setCatalog] = useState<any | null>(null);
  const [tab, setTab] = useState<'apps' | 'entitlements' | 'roles' | 'groups' | 'sod'>('apps');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newApp, setNewApp] = useState(createEmptyApp);
  const [newEnt, setNewEnt] = useState(() => createEmptyEnt());
  const [newRole, setNewRole] = useState(createEmptyRole);
  const [newGroup, setNewGroup] = useState(() => createEmptyGroup());
  const [newSod, setNewSod] = useState(() => createEmptySod());

  const isAdmin = user.operator_role === 'iam_admin';

  const load = async () => {
    const res = await apiRequest<any>('/api/catalog');
    setCatalog(res);
    const firstAppId = res.applications[0]?.id || '';
    const entIds = new Set((res.entitlements || []).map((e: any) => e.id));
    const appIds = new Set((res.applications || []).map((a: any) => a.id));

    setNewEnt((e) => ({
      ...e,
      applicationId: e.applicationId && appIds.has(e.applicationId) ? e.applicationId : firstAppId,
    }));
    setNewGroup((g) => ({
      ...g,
      applicationId: g.applicationId && appIds.has(g.applicationId) ? g.applicationId : firstAppId,
    }));
    setNewSod((s) => ({
      ...s,
      entitlementAId:
        s.entitlementAId && entIds.has(s.entitlementAId)
          ? s.entitlementAId
          : res.entitlements[0]?.id || '',
      entitlementBId:
        s.entitlementBId && entIds.has(s.entitlementBId)
          ? s.entitlementBId
          : res.entitlements[1]?.id || '',
    }));
  };

  useEffect(() => {
    load();
  }, []);

  const runAction = async (fn: () => Promise<any>, successMsg: string, onSuccess?: () => void) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      onSuccess?.();
      setNotice(successMsg);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed');
    }
  };

  if (!catalog) return <div className="text-sm text-slate-500">Loading catalog registry...</div>;

  const hasCatalogData =
    catalog.applications.length > 0 ||
    catalog.entitlements.length > 0 ||
    catalog.roles.length > 0 ||
    catalog.groups.length > 0 ||
    catalog.sodPolicies.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-slate-900">
            Application, Role & SoD Catalog Administration
          </h2>
          <p className="text-sm text-slate-600">
            Full Catalog Admin CRUD for enterprise applications, entitlements, RBAC roles, LDAP groups, and Segregation of Duties policies.
          </p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            {hasCatalogData && (
              <button
                onClick={() =>
                  runAction(
                    () => apiRequest('/api/system/clear-data', { method: 'POST' }),
                    'Cleared all operational and catalog records back to zero.',
                    () => {
                      setNewApp(createEmptyApp());
                      setNewEnt(createEmptyEnt(''));
                      setNewRole(createEmptyRole());
                      setNewGroup(createEmptyGroup(''));
                      setNewSod(createEmptySod('', ''));
                    }
                  )
                }
                className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-red-700 bg-white border border-red-300 rounded-md hover:bg-red-50 whitespace-nowrap shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear All Data
              </button>
            )}
            <button
              onClick={() =>
                runAction(
                  () => apiRequest('/api/catalog/bootstrap-meridian', { method: 'POST' }),
                  'Meridian Wealth Services baseline catalog loaded / verified.'
                )
              }
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Database className="w-3.5 h-3.5" />
              Load Meridian Baseline Catalog
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
        {[
          ['apps', `Applications (${catalog.applications.length})`],
          ['entitlements', `Entitlements (${catalog.entitlements.length})`],
          ['roles', `Business Roles (${catalog.roles.length})`],
          ['groups', `AD / LDAP Groups (${catalog.groups.length})`],
          ['sod', `SoD Policies & Violations (${catalog.sodPolicies.length})`],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => { setTab(k as any); setError(null); setNotice(null); }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md ${
              tab === k ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {notice && <div className="p-3 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-800">{notice}</div>}
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-800">{error}</div>}

      {/* APPLICATIONS TAB */}
      {tab === 'apps' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Code · App Name</th>
                  <th className="px-4 py-3 text-left font-medium">Owner</th>
                  <th className="px-4 py-3 text-left font-medium">Connector</th>
                  <th className="px-4 py-3 text-left font-medium">Failure Sim</th>
                  <th className="px-4 py-3 text-right font-medium">Admin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {catalog.applications.map((a: any) => (
                  <tr key={a.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{a.code} · {a.name}</div>
                      <div className="text-slate-500">{a.criticality} criticality · {a.sla_hours}h SLA</div>
                    </td>
                    <td className="px-4 py-3">{a.owner_name}</td>
                    <td className="px-4 py-3 font-mono">{a.connector_type}</td>
                    <td className="px-4 py-3">
                      <button
                        disabled={!isAdmin && user.operator_role !== 'iam_analyst'}
                        onClick={() =>
                          runAction(
                            () =>
                              apiRequest(`/api/catalog/apps/${a.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ simulateFailure: !a.simulate_failure }),
                              }),
                            `Updated failure simulation for ${a.name}`
                          )
                        }
                        className={`font-mono text-xs underline ${
                          a.simulate_failure ? 'text-red-700 font-semibold' : 'text-slate-600'
                        }`}
                      >
                        {a.simulate_failure ? 'Outage Simulated (ON)' : 'Healthy (OFF)'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isAdmin && (
                        <button
                          onClick={() =>
                            runAction(
                              () => apiRequest(`/api/catalog/apps/${a.id}`, { method: 'DELETE' }),
                              `Deleted application ${a.name}`
                            )
                          }
                          className="text-red-700 hover:underline inline-flex items-center gap-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {catalog.applications.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      No enterprise applications in catalog yet. Add an application or load the baseline catalog.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {isAdmin && (
            <div className="bg-white border border-slate-200 rounded-lg p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display text-sm font-semibold text-slate-900">
                  Add Enterprise Application
                </h3>
                <button
                  type="button"
                  onClick={() => setNewApp(createEmptyApp())}
                  className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
                >
                  <RotateCcw className="w-3 h-3" /> Clear
                </button>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const createdName = newApp.name;
                  runAction(
                    () =>
                      apiRequest('/api/catalog/apps', {
                        method: 'POST',
                        body: JSON.stringify(newApp),
                      }),
                    `Added application ${createdName}`,
                    () => setNewApp(createEmptyApp())
                  );
                }}
                className="space-y-3 text-xs"
              >
                <input
                  required
                  placeholder="Application Name"
                  value={newApp.name}
                  onChange={(e) => setNewApp({ ...newApp, name: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    required
                    placeholder="Code (e.g. TREASURY)"
                    value={newApp.code}
                    onChange={(e) => setNewApp({ ...newApp, code: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md font-mono"
                  />
                  <select
                    value={newApp.criticality}
                    onChange={(e) => setNewApp({ ...newApp, criticality: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md bg-white"
                  >
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                    <option value="critical">critical</option>
                  </select>
                </div>
                <input
                  required
                  placeholder="Owner Full Name"
                  value={newApp.ownerName}
                  onChange={(e) => setNewApp({ ...newApp, ownerName: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                />
                <input
                  type="email"
                  required
                  placeholder="Owner Email"
                  value={newApp.ownerEmail}
                  onChange={(e) => setNewApp({ ...newApp, ownerEmail: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                />
                <textarea
                  required
                  rows={2}
                  placeholder="Application Description"
                  value={newApp.description}
                  onChange={(e) => setNewApp({ ...newApp, description: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                />
                <button
                  type="submit"
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2 bg-blue-700 hover:bg-blue-800 text-white font-medium rounded-md"
                >
                  <Plus className="w-3.5 h-3.5" /> Create Application
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* ENTITLEMENTS TAB */}
      {tab === 'entitlements' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Entitlement · Code</th>
                  <th className="px-4 py-3 text-left font-medium">Application</th>
                  <th className="px-4 py-3 text-left font-medium">Sensitivity</th>
                  <th className="px-4 py-3 text-left font-medium">Compliance Gate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {catalog.entitlements.map((e: any) => (
                  <tr key={e.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{e.name}</div>
                      <div className="font-mono text-slate-500">{e.code}</div>
                    </td>
                    <td className="px-4 py-3">{e.app_name}</td>
                    <td className={`px-4 py-3 font-mono ${statusTextClass(e.sensitivity)}`}>{e.sensitivity}</td>
                    <td className="px-4 py-3">{e.requires_compliance_approval ? 'Required' : 'Standard'}</td>
                  </tr>
                ))}
                {catalog.entitlements.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                      No entitlements defined yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {isAdmin && (
            <div className="bg-white border border-slate-200 rounded-lg p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display text-sm font-semibold text-slate-900">
                  Create Entitlement
                </h3>
                <button
                  type="button"
                  onClick={() => setNewEnt(createEmptyEnt(catalog.applications[0]?.id || ''))}
                  className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
                >
                  <RotateCcw className="w-3 h-3" /> Clear
                </button>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const createdName = newEnt.name;
                  runAction(
                    () => apiRequest('/api/catalog/entitlements', { method: 'POST', body: JSON.stringify(newEnt) }),
                    `Created entitlement ${createdName}`,
                    () => setNewEnt(createEmptyEnt(catalog.applications[0]?.id || ''))
                  );
                }}
                className="space-y-3 text-xs"
              >
                <select
                  required
                  value={newEnt.applicationId}
                  onChange={(e) => setNewEnt({ ...newEnt, applicationId: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md bg-white"
                >
                  {catalog.applications.length === 0 && (
                    <option value="">No applications available (create app first)</option>
                  )}
                  {catalog.applications.map((a: any) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <input
                  required
                  placeholder="Entitlement Name"
                  value={newEnt.name}
                  onChange={(e) => setNewEnt({ ...newEnt, name: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                />
                <input
                  required
                  placeholder="Code (e.g. WMP_AUDIT_READ)"
                  value={newEnt.code}
                  onChange={(e) => setNewEnt({ ...newEnt, code: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md font-mono"
                />
                <select
                  value={newEnt.sensitivity}
                  onChange={(e) => setNewEnt({ ...newEnt, sensitivity: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md bg-white"
                >
                  <option value="standard">standard</option>
                  <option value="high">high</option>
                  <option value="critical">critical</option>
                </select>
                <textarea
                  required
                  rows={2}
                  placeholder="Description"
                  value={newEnt.description}
                  onChange={(e) => setNewEnt({ ...newEnt, description: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                />
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={newEnt.requiresComplianceApproval}
                    onChange={(e) => setNewEnt({ ...newEnt, requiresComplianceApproval: e.target.checked })}
                  />
                  Require Compliance Approval Gate
                </label>
                <button
                  type="submit"
                  disabled={!newEnt.applicationId}
                  className="w-full py-2 bg-blue-700 hover:bg-blue-800 text-white font-medium rounded-md disabled:opacity-50"
                >
                  Create Entitlement
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* BUSINESS ROLES TAB */}
      {tab === 'roles' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-3">
            {catalog.roles.map((r: any) => (
              <div key={r.id} className="bg-white border border-slate-200 rounded-lg p-4 text-xs">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-display text-sm font-semibold text-slate-900">{r.name}</div>
                    <div className="text-slate-500">{r.department} · Risk: {r.risk_level}</div>
                    <div className="mt-1 text-slate-600">{r.description}</div>
                  </div>
                </div>
                <div className="mt-3 pt-2 border-t border-slate-100">
                  <div className="font-medium text-slate-700 mb-1">
                    Mapped Entitlements ({r.entitlements.length}):
                  </div>
                  <div className="text-slate-600">
                    {r.entitlements.map((e: any) => `${e.app_name}: ${e.name}`).join(' · ') || 'None'}
                  </div>
                </div>
              </div>
            ))}
            {catalog.roles.length === 0 && (
              <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-xs text-slate-500">
                No business roles configured yet.
              </div>
            )}
          </div>

          {isAdmin && (
            <div className="bg-white border border-slate-200 rounded-lg p-5 h-fit">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display text-sm font-semibold text-slate-900">
                  Create Business Role
                </h3>
                <button
                  type="button"
                  onClick={() => setNewRole(createEmptyRole())}
                  className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
                >
                  <RotateCcw className="w-3 h-3" /> Clear
                </button>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const createdName = newRole.name;
                  runAction(
                    () => apiRequest('/api/catalog/roles', { method: 'POST', body: JSON.stringify(newRole) }),
                    `Created business role ${createdName}`,
                    () => setNewRole(createEmptyRole())
                  );
                }}
                className="space-y-3 text-xs"
              >
                <input
                  required
                  placeholder="Role Name (e.g. Portfolio Risk Analyst)"
                  value={newRole.name}
                  onChange={(e) => setNewRole({ ...newRole, name: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                />
                <input
                  required
                  placeholder="Department"
                  value={newRole.department}
                  onChange={(e) => setNewRole({ ...newRole, department: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                />
                <textarea
                  required
                  rows={2}
                  placeholder="Role Scope Description"
                  value={newRole.description}
                  onChange={(e) => setNewRole({ ...newRole, description: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                />
                <div>
                  <div className="font-medium text-slate-700 mb-1">Select Entitlements:</div>
                  <div className="max-h-40 overflow-y-auto border border-slate-200 rounded p-2 space-y-1">
                    {catalog.entitlements.length === 0 && (
                      <div className="text-slate-500 py-2 text-center">No entitlements in catalog yet.</div>
                    )}
                    {catalog.entitlements.map((e: any) => (
                      <label key={e.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={newRole.entitlementIds.includes(e.id)}
                          onChange={(ev) => {
                            const next = ev.target.checked
                              ? [...newRole.entitlementIds, e.id]
                              : newRole.entitlementIds.filter((x) => x !== e.id);
                            setNewRole({ ...newRole, entitlementIds: next });
                          }}
                        />
                        <span>{e.app_code} · {e.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <button type="submit" className="w-full py-2 bg-blue-700 hover:bg-blue-800 text-white font-medium rounded-md">
                  Create Role & Map Entitlements
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* GROUPS TAB */}
      {tab === 'groups' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Group Name</th>
                  <th className="px-4 py-3 text-left font-medium">OpenLDAP Distinguished Name</th>
                  <th className="px-4 py-3 text-right font-medium">Members</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {catalog.groups.map((g: any) => (
                  <tr key={g.id}>
                    <td className="px-4 py-3 font-medium text-slate-900">{g.name}</td>
                    <td className="px-4 py-3 font-mono text-slate-600">{g.dn}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{g.member_count}</td>
                  </tr>
                ))}
                {catalog.groups.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-slate-500">
                      No AD / OpenLDAP directory groups configured yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {isAdmin && (
            <div className="bg-white border border-slate-200 rounded-lg p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display text-sm font-semibold text-slate-900">Create Directory Group</h3>
                <button
                  type="button"
                  onClick={() => setNewGroup(createEmptyGroup(catalog.applications[0]?.id || ''))}
                  className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
                >
                  <RotateCcw className="w-3 h-3" /> Clear
                </button>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const createdName = newGroup.name;
                  runAction(
                    () => apiRequest('/api/catalog/groups', { method: 'POST', body: JSON.stringify(newGroup) }),
                    `Created LDAP group ${createdName}`,
                    () => setNewGroup(createEmptyGroup(catalog.applications[0]?.id || ''))
                  );
                }}
                className="space-y-3 text-xs"
              >
                <input
                  required
                  placeholder="Group Name (e.g. cn-risk-analysts)"
                  value={newGroup.name}
                  onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                />
                <input
                  required
                  placeholder="DN (cn=...,ou=groups,dc=meridian,dc=internal)"
                  value={newGroup.dn}
                  onChange={(e) => setNewGroup({ ...newGroup, dn: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md font-mono"
                />
                <input
                  required
                  placeholder="Description"
                  value={newGroup.description}
                  onChange={(e) => setNewGroup({ ...newGroup, description: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                />
                <button type="submit" className="w-full py-2 bg-blue-700 hover:bg-blue-800 text-white font-medium rounded-md">
                  Create Directory Group
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* SOD POLICIES TAB */}
      {tab === 'sod' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">SoD Policy</th>
                    <th className="px-4 py-3 text-left font-medium">Conflicting Entitlement Pair</th>
                    <th className="px-4 py-3 text-left font-medium">Enforcement</th>
                    <th className="px-4 py-3 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {catalog.sodPolicies.map((sp: any) => (
                    <tr key={sp.id}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{sp.name}</div>
                        <div className="text-slate-500">{sp.description}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px]">
                        {sp.entitlement_a_name} <br />↔ {sp.entitlement_b_name}
                      </td>
                      <td className={`px-4 py-3 uppercase font-mono ${statusTextClass(sp.severity)}`}>
                        {sp.enforcement_action} ({sp.severity})
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isAdmin && (
                          <button
                            onClick={() =>
                              runAction(
                                () => apiRequest(`/api/catalog/sod-policies/${sp.id}`, { method: 'DELETE' }),
                                `Removed SoD policy ${sp.name}`
                              )
                            }
                            className="text-red-700 hover:underline"
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {catalog.sodPolicies.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                        No Segregation of Duties (SoD) policies defined yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {isAdmin && (
              <div className="bg-white border border-slate-200 rounded-lg p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-display text-sm font-semibold text-slate-900">
                    Create SoD Conflict Policy
                  </h3>
                  <button
                    type="button"
                    onClick={() =>
                      setNewSod(
                        createEmptySod(catalog.entitlements[0]?.id || '', catalog.entitlements[1]?.id || '')
                      )
                    }
                    className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
                  >
                    <RotateCcw className="w-3 h-3" /> Clear
                  </button>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const createdName = newSod.name;
                    runAction(
                      () => apiRequest('/api/catalog/sod-policies', { method: 'POST', body: JSON.stringify(newSod) }),
                      `Created SoD policy ${createdName}`,
                      () =>
                        setNewSod(
                          createEmptySod(catalog.entitlements[0]?.id || '', catalog.entitlements[1]?.id || '')
                        )
                    );
                  }}
                  className="space-y-3 text-xs"
                >
                  <input
                    required
                    placeholder="Policy Name"
                    value={newSod.name}
                    onChange={(e) => setNewSod({ ...newSod, name: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                  />
                  <select
                    required
                    value={newSod.entitlementAId}
                    onChange={(e) => setNewSod({ ...newSod, entitlementAId: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md bg-white"
                  >
                    {catalog.entitlements.length === 0 && (
                      <option value="">No entitlements available</option>
                    )}
                    {catalog.entitlements.map((e: any) => (
                      <option key={e.id} value={e.id}>{e.app_code} · {e.name}</option>
                    ))}
                  </select>
                  <select
                    required
                    value={newSod.entitlementBId}
                    onChange={(e) => setNewSod({ ...newSod, entitlementBId: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md bg-white"
                  >
                    {catalog.entitlements.length < 2 && (
                      <option value="">Need at least 2 entitlements</option>
                    )}
                    {catalog.entitlements.map((e: any) => (
                      <option key={e.id} value={e.id}>{e.app_code} · {e.name}</option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={newSod.severity}
                      onChange={(e) => setNewSod({ ...newSod, severity: e.target.value })}
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-md bg-white"
                    >
                      <option value="medium">medium</option>
                      <option value="high">high</option>
                      <option value="critical">critical</option>
                    </select>
                    <select
                      value={newSod.enforcementAction}
                      onChange={(e) => setNewSod({ ...newSod, enforcementAction: e.target.value })}
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-md bg-white"
                    >
                      <option value="block">block</option>
                      <option value="warn">warn</option>
                    </select>
                  </div>
                  <textarea
                    required
                    rows={2}
                    placeholder="Control rationale..."
                    value={newSod.description}
                    onChange={(e) => setNewSod({ ...newSod, description: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                  />
                  <button
                    type="submit"
                    disabled={!newSod.entitlementAId || !newSod.entitlementBId}
                    className="w-full py-2 bg-blue-700 hover:bg-blue-800 text-white font-medium rounded-md disabled:opacity-50"
                  >
                    Add SoD Policy
                  </button>
                </form>
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h3 className="font-display text-sm font-semibold text-slate-900 mb-3">
              Recorded SoD Conflict Detections
            </h3>
            <table className="w-full text-xs">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2 text-left">Policy</th>
                  <th className="py-2 text-left">Identity</th>
                  <th className="py-2 text-left">Details</th>
                  <th className="py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {catalog.sodViolations.map((v: any) => (
                  <tr key={v.id}>
                    <td className="py-2 font-medium">{v.policy_name}</td>
                    <td className="py-2">{v.identity_name}</td>
                    <td className="py-2 text-slate-600">{v.mitigation_notes}</td>
                    <td className={`py-2 ${statusTextClass(v.status)}`}>{v.status}</td>
                  </tr>
                ))}
                {catalog.sodViolations.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-slate-500">No SoD violations logged yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};


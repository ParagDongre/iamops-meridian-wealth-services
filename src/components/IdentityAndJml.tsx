import React, { useEffect, useState } from 'react';
import { Plus, Search, UserCheck, UserMinus, UserPlus, X } from 'lucide-react';
import { apiRequest, formatTimestamp, statusTextClass, type AuthUser } from '../types';

export const IdentityDirectoryModule: React.FC<{ user: AuthUser }> = ({ user }) => {
  const [identities, setIdentities] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createEmptyIdentityForm = (defaultRoleId = '') => ({
    fullName: '',
    email: '',
    department: 'Wealth Management',
    jobTitle: '',
    managerId: '',
    employmentType: 'Full-Time',
    location: 'New York',
    joiningDate: new Date().toISOString().slice(0, 10),
    businessRoleId: defaultRoleId,
  });

  const [form, setForm] = useState(() => createEmptyIdentityForm());

  const canWrite = user.operator_role === 'iam_admin' || user.operator_role === 'iam_analyst';

  const load = async () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (deptFilter !== 'All') params.set('department', deptFilter);
    if (statusFilter !== 'All') params.set('status', statusFilter);
    const [idRes, catRes] = await Promise.all([
      apiRequest<{ identities: any[] }>(`/api/identities?${params.toString()}`),
      apiRequest<{ roles: any[] }>('/api/catalog'),
    ]);
    setIdentities(idRes.identities);
    setRoles(catRes.roles);
    const roleIds = new Set(catRes.roles.map((r: any) => r.id));
    setForm((f) => ({
      ...f,
      businessRoleId:
        f.businessRoleId && roleIds.has(f.businessRoleId)
          ? f.businessRoleId
          : catRes.roles[0]?.id || '',
    }));
  };

  useEffect(() => {
    load();
  }, [search, deptFilter, statusFilter]);

  const openDetail = async (id: string) => {
    setSelectedId(id);
    const d = await apiRequest(`/api/identities/${id}`);
    setDetail(d);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await apiRequest('/api/identities', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          managerId: form.managerId || null,
        }),
      });
      setShowCreate(false);
      setForm(createEmptyIdentityForm(roles[0]?.id || ''));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create identity');
    }
  };

  const handleToggleLifecycle = async (id: string, current: string) => {
    const target = current === 'Active' ? 'Disabled' : 'Active';
    await apiRequest(`/api/identities/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({
        lifecycleStatus: target,
        reason: target === 'Disabled' ? 'Deactivated from Identity Directory' : 'Reactivated by IAM Ops',
      }),
    });
    await load();
    if (selectedId === id) {
      await openDetail(id);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-slate-900">
            Workforce Identity Directory
          </h2>
          <p className="text-sm text-slate-600">
            Authoritative Meridian Wealth Services identities synced to Keycloak IdP and OpenLDAP entries.
          </p>
        </div>
        {canWrite && (
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            Create Identity
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by employee ID, name, email, or title..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-md"
          />
        </div>
        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white"
        >
          {['All', 'Wealth Management', 'Finance', 'Compliance', 'Operations', 'IT', 'Human Resources'].map(
            (d) => (
              <option key={d} value={d}>
                {d === 'All' ? 'All Departments' : d}
              </option>
            )
          )}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white"
        >
          <option value="All">All Statuses</option>
          <option value="Active">Active</option>
          <option value="Disabled">Disabled</option>
        </select>
        {(search || deptFilter !== 'All' || statusFilter !== 'All') && (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setDeptFilter('All');
              setStatusFilter('All');
            }}
            className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-300 rounded-md hover:bg-slate-50"
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Employee ID</th>
                <th className="px-4 py-3 text-left font-medium">Name & Email</th>
                <th className="px-4 py-3 text-left font-medium">Department · Title</th>
                <th className="px-4 py-3 text-left font-medium">Business Role</th>
                <th className="px-4 py-3 text-right font-medium">Apps / Ents</th>
                <th className="px-4 py-3 text-left font-medium">Lifecycle</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {identities.map((id) => (
                <tr key={id.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono font-medium text-slate-900">{id.employee_id}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{id.full_name}</div>
                    <div className="text-slate-500 font-mono">{id.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-slate-800">{id.department}</div>
                    <div className="text-slate-500">{id.job_title} · {id.location}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{id.role_name || 'Unassigned'}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                    {id.active_apps_count} / {id.active_entitlements_count}
                  </td>
                  <td className={`px-4 py-3 ${statusTextClass(id.lifecycle_status)}`}>
                    {id.lifecycle_status} ({id.employment_status})
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                    <button
                      onClick={() => openDetail(id.id)}
                      className="text-blue-700 hover:underline font-medium"
                    >
                      Inspect
                    </button>
                    {canWrite && (
                      <button
                        onClick={() => handleToggleLifecycle(id.id, id.lifecycle_status)}
                        className={`font-medium hover:underline ${
                          id.lifecycle_status === 'Active' ? 'text-red-700' : 'text-emerald-700'
                        }`}
                      >
                        {id.lifecycle_status === 'Active' ? 'Deactivate' : 'Activate'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {identities.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    No workforce identities in directory yet. Create an identity or load data/dummy-data.json from System Configuration.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Identity Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Create Workforce Identity
              </h3>
              <button onClick={() => setShowCreate(false)} className="text-slate-500 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>
            {error && (
              <div className="mb-3 p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-800">
                {error}
              </div>
            )}
            <form onSubmit={handleCreate} className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
                  <input
                    required
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Corporate Email</label>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="name@meridianwealth.internal"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Department</label>
                  <select
                    value={form.department}
                    onChange={(e) => setForm({ ...form, department: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md bg-white"
                  >
                    {['Wealth Management', 'Finance', 'Compliance', 'Operations', 'IT', 'Human Resources'].map(
                      (d) => (
                        <option key={d} value={d}>{d}</option>
                      )
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Job Title</label>
                  <input
                    required
                    value={form.jobTitle}
                    onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Business Role</label>
                  <select
                    value={form.businessRoleId}
                    onChange={(e) => setForm({ ...form, businessRoleId: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md bg-white"
                  >
                    {roles.length === 0 && (
                      <option value="">No business roles configured</option>
                    )}
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Location</label>
                  <input
                    required
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                  />
                </div>
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md"
                >
                  Create Identity
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Identity Inspection Drawer */}
      {detail && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex justify-end">
          <div className="bg-white w-full max-w-2xl h-full overflow-y-auto p-6 border-l border-slate-200 space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs font-mono text-slate-500">
                  {detail.identity.employee_id} · {detail.identity.department} · {detail.identity.location}
                </div>
                <h3 className="font-display text-lg font-semibold text-slate-900 mt-1">
                  {detail.identity.full_name}
                </h3>
                <div className="text-xs text-slate-600">
                  {detail.identity.job_title} · Manager: {detail.identity.manager_name || 'Executive Board'}
                </div>
              </div>
              <button onClick={() => setDetail(null)} className="text-slate-500 hover:text-slate-800">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="border border-slate-200 rounded-md p-3">
                <div className="font-semibold text-slate-800 mb-1">Keycloak IdP Account</div>
                {detail.idpAccount ? (
                  <div className="space-y-1 font-mono text-slate-600">
                    <div>ID: {detail.idpAccount.keycloak_user_id}</div>
                    <div>Realm: {detail.idpAccount.realm}</div>
                    <div className={detail.idpAccount.enabled ? 'text-emerald-700' : 'text-red-700'}>
                      Enabled: {detail.idpAccount.enabled ? 'true' : 'false (Locked)'}
                    </div>
                  </div>
                ) : (
                  <div className="text-slate-500">Not provisioned in IdP</div>
                )}
              </div>
              <div className="border border-slate-200 rounded-md p-3">
                <div className="font-semibold text-slate-800 mb-1">OpenLDAP Directory Entry</div>
                {detail.ldapEntry ? (
                  <div className="space-y-1 font-mono text-slate-600 break-all">
                    <div>DN: {detail.ldapEntry.dn}</div>
                    <div className={detail.ldapEntry.ns_account_lock ? 'text-red-700' : 'text-emerald-700'}>
                      nsAccountLock: {detail.ldapEntry.ns_account_lock ? 'TRUE' : 'FALSE'}
                    </div>
                  </div>
                ) : (
                  <div className="text-slate-500">No LDAP entry</div>
                )}
              </div>
            </div>

            <div>
              <h4 className="font-display text-sm font-semibold text-slate-900 mb-2">
                Assigned Application Accounts & Entitlements
              </h4>
              <table className="w-full text-xs border border-slate-200">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="p-2 text-left">Application</th>
                    <th className="p-2 text-left">Entitlement</th>
                    <th className="p-2 text-left">Sensitivity</th>
                    <th className="p-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detail.entitlements.map((e: any) => (
                    <tr key={e.id}>
                      <td className="p-2 font-medium">{e.app_name}</td>
                      <td className="p-2">{e.entitlement_name}</td>
                      <td className="p-2 font-mono">{e.sensitivity}</td>
                      <td className={`p-2 ${statusTextClass(e.status)}`}>{e.status}</td>
                    </tr>
                  ))}
                  {detail.entitlements.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-3 text-center text-slate-500">
                        Zero entitlements currently assigned.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div>
              <h4 className="font-display text-sm font-semibold text-slate-900 mb-2">
                Identity Audit History
              </h4>
              <div className="space-y-2">
                {detail.history.map((h: any) => (
                  <div key={h.id} className="text-xs border-b border-slate-100 pb-2">
                    <div className="flex justify-between font-mono text-slate-500">
                      <span>{h.id} · {h.actor}</span>
                      <span>{formatTimestamp(h.timestamp)}</span>
                    </div>
                    <div className="text-slate-800 mt-0.5">{h.action}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const JmlWorkflowModule: React.FC<{ user: AuthUser }> = ({ user }) => {
  const [tab, setTab] = useState<'joiner' | 'mover' | 'leaver'>('joiner');
  const [identities, setIdentities] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [output, setOutput] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const createEmptyJoiner = (defaultRoleId = '') => ({
    fullName: '',
    email: '',
    department: 'Wealth Management',
    jobTitle: '',
    managerId: '',
    employmentType: 'Full-Time',
    location: 'New York',
    joiningDate: new Date().toISOString().slice(0, 10),
    businessRoleId: defaultRoleId,
    autoApproveStandard: false,
  });

  const createEmptyMover = (defaultId = '', defaultRoleId = '') => ({
    identityId: defaultId,
    newDepartment: 'Compliance',
    newJobTitle: '',
    newBusinessRoleId: defaultRoleId,
    justification: '',
  });

  const createEmptyLeaver = (defaultId = '') => ({
    identityId: defaultId,
    terminationReason: '',
  });

  const [joiner, setJoiner] = useState(() => createEmptyJoiner());
  const [mover, setMover] = useState(() => createEmptyMover());
  const [leaver, setLeaver] = useState(() => createEmptyLeaver());

  const load = async () => {
    const [idRes, catRes] = await Promise.all([
      apiRequest<{ identities: any[] }>('/api/identities'),
      apiRequest<{ roles: any[] }>('/api/catalog'),
    ]);
    setIdentities(idRes.identities);
    setRoles(catRes.roles);

    const roleIds = new Set(catRes.roles.map((r: any) => r.id));
    const firstRoleId = catRes.roles[0]?.id || '';
    const active = idRes.identities.filter((i) => i.lifecycle_status === 'Active');
    const activeIds = new Set(active.map((i) => i.id));
    const firstActiveId = active[0]?.id || '';

    setJoiner((j) => ({
      ...j,
      businessRoleId: j.businessRoleId && roleIds.has(j.businessRoleId) ? j.businessRoleId : firstRoleId,
    }));
    setMover((m) => ({
      ...m,
      identityId: m.identityId && activeIds.has(m.identityId) ? m.identityId : firstActiveId,
      newBusinessRoleId:
        m.newBusinessRoleId && roleIds.has(m.newBusinessRoleId) ? m.newBusinessRoleId : firstRoleId,
    }));
    setLeaver((l) => ({
      ...l,
      identityId: l.identityId && activeIds.has(l.identityId) ? l.identityId : firstActiveId,
    }));
  };

  useEffect(() => {
    load();
  }, []);

  const canRun = user.operator_role === 'iam_admin' || user.operator_role === 'iam_analyst';

  const submitJoiner = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setOutput(null);
    try {
      const res = await apiRequest('/api/jml/joiner', {
        method: 'POST',
        body: JSON.stringify({ ...joiner, managerId: joiner.managerId || null }),
      });
      setOutput({ type: 'Joiner Completed', data: res });
      setJoiner(createEmptyJoiner(roles[0]?.id || ''));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Joiner workflow failed');
    } finally {
      setSubmitting(false);
    }
  };

  const submitMover = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setOutput(null);
    try {
      const res = await apiRequest('/api/jml/mover', {
        method: 'POST',
        body: JSON.stringify(mover),
      });
      setOutput({ type: 'Mover Completed', data: res });
      setMover((m) => createEmptyMover(m.identityId, roles[0]?.id || ''));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mover workflow failed');
    } finally {
      setSubmitting(false);
    }
  };

  const submitLeaver = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setOutput(null);
    try {
      const res = await apiRequest('/api/jml/leaver', {
        method: 'POST',
        body: JSON.stringify(leaver),
      });
      setOutput({ type: 'Leaver Completed (Zero-Privilege Safeguard Verified)', data: res });
      setLeaver(createEmptyLeaver(''));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Leaver workflow failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-semibold text-slate-900">
          Joiner / Mover / Leaver (JML) Lifecycle Engine
        </h2>
        <p className="text-sm text-slate-600">
          Orchestrated HR-driven identity lifecycle workflows with role entitlement calculation, SoD enforcement, and zero-privilege termination safeguards.
        </p>
      </div>

      {/* Segmented Tabs */}
      <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
        <button
          onClick={() => { setTab('joiner'); setOutput(null); setError(null); }}
          className={`inline-flex items-center gap-2 px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${
            tab === 'joiner' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <UserPlus className="w-3.5 h-3.5" />
          Joiner Onboarding
        </button>
        <button
          onClick={() => { setTab('mover'); setOutput(null); setError(null); }}
          className={`inline-flex items-center gap-2 px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${
            tab === 'mover' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <UserCheck className="w-3.5 h-3.5" />
          Mover Transfer
        </button>
        <button
          onClick={() => { setTab('leaver'); setOutput(null); setError(null); }}
          className={`inline-flex items-center gap-2 px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${
            tab === 'leaver' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <UserMinus className="w-3.5 h-3.5" />
          Leaver Termination
        </button>
      </div>

      {!canRun && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-900">
          Read-only view: JML execution requires <span className="font-mono">iam_admin</span> or <span className="font-mono">iam_analyst</span> role.
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-800">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          {tab === 'joiner' && (
            <form onSubmit={submitJoiner} className="space-y-4 text-sm">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Execute Joiner Onboarding
                </h3>
                <button
                  type="button"
                  onClick={() => setJoiner(createEmptyJoiner(roles[0]?.id || ''))}
                  className="text-xs text-slate-500 hover:text-slate-800"
                >
                  Clear Form
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
                  <input
                    required
                    value={joiner.fullName}
                    onChange={(e) => setJoiner({ ...joiner, fullName: e.target.value })}
                    placeholder="e.g. Jordan Hayes"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={joiner.email}
                    onChange={(e) => setJoiner({ ...joiner, email: e.target.value })}
                    placeholder="jordan.hayes@meridianwealth.internal"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Department</label>
                  <select
                    value={joiner.department}
                    onChange={(e) => setJoiner({ ...joiner, department: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md bg-white"
                  >
                    {['Wealth Management', 'Finance', 'Compliance', 'Operations', 'IT', 'Human Resources'].map(
                      (d) => (
                        <option key={d} value={d}>{d}</option>
                      )
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Job Title</label>
                  <input
                    required
                    placeholder="e.g. Associate Wealth Advisor"
                    value={joiner.jobTitle}
                    onChange={(e) => setJoiner({ ...joiner, jobTitle: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Business Role</label>
                  <select
                    value={joiner.businessRoleId}
                    onChange={(e) => setJoiner({ ...joiner, businessRoleId: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md bg-white"
                  >
                    {roles.length === 0 && <option value="">No business roles configured</option>}
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Manager</label>
                  <select
                    value={joiner.managerId}
                    onChange={(e) => setJoiner({ ...joiner, managerId: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md bg-white"
                  >
                    <option value="">None / Executive</option>
                    {identities.filter((i) => i.lifecycle_status === 'Active').map((i) => (
                      <option key={i.id} value={i.id}>{i.full_name} ({i.department})</option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={joiner.autoApproveStandard}
                  onChange={(e) => setJoiner({ ...joiner, autoApproveStandard: e.target.checked })}
                />
                Auto-approve standard-sensitivity birthright entitlements (high/critical still require Compliance & Owner approvals)
              </label>
              <button
                type="submit"
                disabled={!canRun || submitting}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md disabled:opacity-50"
              >
                {submitting ? 'Running Joiner...' : 'Run Joiner Workflow'}
              </button>
            </form>
          )}

          {tab === 'mover' && (
            <form onSubmit={submitMover} className="space-y-4 text-sm">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Execute Mover Role & Department Transition
                </h3>
                <button
                  type="button"
                  onClick={() => setMover(createEmptyMover(mover.identityId, roles[0]?.id || ''))}
                  className="text-xs text-slate-500 hover:text-slate-800"
                >
                  Clear Form
                </button>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Target Employee</label>
                <select
                  required
                  value={mover.identityId}
                  onChange={(e) => setMover({ ...mover, identityId: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md bg-white"
                >
                  {identities.filter((i) => i.lifecycle_status === 'Active').length === 0 && (
                    <option value="">No active identities available</option>
                  )}
                  {identities.filter((i) => i.lifecycle_status === 'Active').map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.employee_id} · {i.full_name} (Current: {i.role_name || 'None'})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">New Department</label>
                  <select
                    value={mover.newDepartment}
                    onChange={(e) => setMover({ ...mover, newDepartment: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md bg-white"
                  >
                    {['Wealth Management', 'Finance', 'Compliance', 'Operations', 'IT', 'Human Resources'].map(
                      (d) => (
                        <option key={d} value={d}>{d}</option>
                      )
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">New Job Title</label>
                  <input
                    required
                    placeholder="e.g. Compliance Analyst"
                    value={mover.newJobTitle}
                    onChange={(e) => setMover({ ...mover, newJobTitle: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">New Business Role</label>
                <select
                  value={mover.newBusinessRoleId}
                  onChange={(e) => setMover({ ...mover, newBusinessRoleId: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md bg-white"
                >
                  {roles.length === 0 && <option value="">No business roles configured</option>}
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Transfer Justification</label>
                <input
                  required
                  placeholder="Internal lateral transfer approved by HR & Department Heads"
                  value={mover.justification}
                  onChange={(e) => setMover({ ...mover, justification: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                />
              </div>
              <button
                type="submit"
                disabled={!canRun || submitting || !mover.identityId}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md disabled:opacity-50"
              >
                {submitting ? 'Recalculating Access...' : 'Execute Mover & Diff Entitlements'}
              </button>
            </form>
          )}

          {tab === 'leaver' && (
            <form onSubmit={submitLeaver} className="space-y-4 text-sm">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Execute Leaver Offboarding & Revocation
                </h3>
                <button
                  type="button"
                  onClick={() => setLeaver(createEmptyLeaver(leaver.identityId))}
                  className="text-xs text-slate-500 hover:text-slate-800"
                >
                  Clear Form
                </button>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Employee to Terminate</label>
                <select
                  required
                  value={leaver.identityId}
                  onChange={(e) => setLeaver({ ...leaver, identityId: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md bg-white"
                >
                  {identities.filter((i) => i.lifecycle_status === 'Active').length === 0 && (
                    <option value="">No active identities available</option>
                  )}
                  {identities.filter((i) => i.lifecycle_status === 'Active').map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.employee_id} · {i.full_name} ({i.active_entitlements_count} active entitlements)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Termination Reason</label>
                <textarea
                  rows={3}
                  required
                  placeholder="e.g. Voluntary resignation — immediate end-of-service offboarding"
                  value={leaver.terminationReason}
                  onChange={(e) => setLeaver({ ...leaver, terminationReason: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                />
              </div>
              <button
                type="submit"
                disabled={!canRun || submitting || !leaver.identityId}
                className="px-4 py-2 text-xs font-medium text-white bg-red-700 hover:bg-red-800 rounded-md disabled:opacity-50"
              >
                {submitting ? 'Revoking All Access...' : 'Terminate Identity & Revoke All Access'}
              </button>
            </form>
          )}
        </div>

        {/* Execution Output Panel */}
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <h3 className="font-display text-base font-semibold text-slate-900 mb-2">
            Workflow Execution Result
          </h3>
          {!output ? (
            <p className="text-xs text-slate-500">
              Run a Joiner, Mover, or Leaver workflow to inspect generated access requests, revocation work items, IdP/LDAP updates, and zero-privilege verification.
            </p>
          ) : (
            <div className="space-y-3 text-xs">
              <div className="font-semibold text-emerald-700">{output.type}</div>
              <pre className="p-3 bg-slate-50 border border-slate-200 rounded-md font-mono text-[11px] overflow-x-auto max-h-96">
                {JSON.stringify(output.data, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

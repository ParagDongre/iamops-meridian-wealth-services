import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Plus, RefreshCw, RotateCcw, X } from 'lucide-react';
import { apiRequest, formatTimestamp, statusTextClass, type AuthUser } from '../types';

export const AccessRequestsModule: React.FC<{ user: AuthUser }> = ({ user }) => {
  const [requests, setRequests] = useState<any[]>([]);
  const [identities, setIdentities] = useState<any[]>([]);
  const [apps, setApps] = useState<any[]>([]);
  const [entitlements, setEntitlements] = useState<any[]>([]);
  const [filter, setFilter] = useState('All');
  const [selectedReq, setSelectedReq] = useState<any | null>(null);
  const [decisionComment, setDecisionComment] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [sodPreview, setSodPreview] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    targetIdentityId: '',
    applicationId: '',
    entitlementId: '',
    requestType: 'New Access',
    priority: 'medium',
    businessJustification: '',
  });

  const canDecide = ['iam_admin', 'iam_analyst', 'manager', 'app_owner'].includes(user.operator_role);

  const load = async () => {
    const [reqRes, idRes, catRes] = await Promise.all([
      apiRequest<{ requests: any[] }>('/api/requests'),
      apiRequest<{ identities: any[] }>('/api/identities'),
      apiRequest<{ applications: any[]; entitlements: any[] }>('/api/catalog'),
    ]);
    setRequests(reqRes.requests);
    setIdentities(idRes.identities);
    setApps(catRes.applications);
    setEntitlements(catRes.entitlements);

    const idSet = new Set(idRes.identities.map((i) => i.id));
    const appSet = new Set(catRes.applications.map((a) => a.id));
    const entSet = new Set(catRes.entitlements.map((e) => e.id));

    const activeId = idRes.identities.find((i) => i.lifecycle_status === 'Active')?.id || idRes.identities[0]?.id || '';
    const firstApp = catRes.applications[0]?.id || '';

    setForm((f) => {
      const nextId = f.targetIdentityId && idSet.has(f.targetIdentityId) ? f.targetIdentityId : activeId;
      const nextApp = f.applicationId && appSet.has(f.applicationId) ? f.applicationId : firstApp;
      const firstEntForApp = catRes.entitlements.find((e) => e.application_id === nextApp)?.id || '';
      const nextEnt = f.entitlementId && entSet.has(f.entitlementId) ? f.entitlementId : firstEntForApp;
      return {
        ...f,
        targetIdentityId: nextId,
        applicationId: nextApp,
        entitlementId: nextEnt,
      };
    });
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (form.targetIdentityId && form.entitlementId && form.requestType !== 'Access Revocation') {
      apiRequest('/api/rbac/check-sod', {
        method: 'POST',
        body: JSON.stringify({ identityId: form.targetIdentityId, entitlementId: form.entitlementId }),
      })
        .then(setSodPreview)
        .catch(() => setSodPreview(null));
    } else {
      setSodPreview(null);
    }
  }, [form.targetIdentityId, form.entitlementId, form.requestType]);

  const openDetail = async (id: string) => {
    const res = await apiRequest(`/api/requests/${id}`);
    setSelectedReq(res);
    setDecisionComment('');
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await apiRequest('/api/requests', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setShowCreate(false);
      setForm((f) => ({
        ...f,
        requestType: 'New Access',
        priority: 'medium',
        businessJustification: '',
      }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request submission failed');
    }
  };

  const handleDecision = async (decision: 'Approved' | 'Rejected') => {
    if (!selectedReq) return;
    setError(null);
    try {
      await apiRequest(`/api/requests/${selectedReq.request.id}/decide`, {
        method: 'POST',
        body: JSON.stringify({ decision, comments: decisionComment }),
      });
      await load();
      await openDetail(selectedReq.request.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Decision failed');
    }
  };

  const filtered = requests.filter((r) =>
    filter === 'All' ? true : r.approval_status === filter || r.completion_status === filter
  );
  const appEnts = entitlements.filter((e) => e.application_id === form.applicationId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-slate-900">
            Access Request & Approval Engine
          </h2>
          <p className="text-sm text-slate-600">
            Multi-stage Manager, Application Owner, and Compliance approvals with duplicate & SoD policy blocking.
          </p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setError(null); }}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          New Access Request
        </button>
      </div>

      {/* Filter segmented bar */}
      <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
        {['All', 'Pending Approval', 'Approved', 'Rejected', 'Fulfilled', 'Failed'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              filter === f ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Request ID</th>
                <th className="px-4 py-3 text-left font-medium">Target Identity</th>
                <th className="px-4 py-3 text-left font-medium">Application · Entitlement</th>
                <th className="px-4 py-3 text-left font-medium">Stage · Approver</th>
                <th className="px-4 py-3 text-left font-medium">Approval</th>
                <th className="px-4 py-3 text-left font-medium">Provisioning</th>
                <th className="px-4 py-3 text-left font-medium">SLA Deadline</th>
                <th className="px-4 py-3 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono font-medium text-slate-900">{r.request_number}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{r.target_name}</div>
                    <div className="text-slate-500 font-mono">{r.employee_id}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-slate-800">{r.app_name}</div>
                    <div className="text-slate-500">{r.ent_name} ({r.sensitivity})</div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {r.current_stage} · {r.assigned_approver}
                  </td>
                  <td className={`px-4 py-3 ${statusTextClass(r.approval_status)}`}>{r.approval_status}</td>
                  <td className={`px-4 py-3 ${statusTextClass(r.completion_status)}`}>{r.completion_status}</td>
                  <td className={`px-4 py-3 font-mono tabular-nums ${r.is_sla_breached ? 'text-red-700 font-semibold' : 'text-slate-600'}`}>
                    {formatTimestamp(r.sla_deadline)}
                    {r.is_sla_breached ? ' (BREACHED)' : ''}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openDetail(r.id)}
                      className="text-blue-700 hover:underline font-medium"
                    >
                      Review / Details
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    No access requests match the selected filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Request Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Submit Access Request
              </h3>
              <button onClick={() => setShowCreate(false)} className="text-slate-500">
                <X className="w-4 h-4" />
              </button>
            </div>
            {error && (
              <div className="mb-3 p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-800">
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Target Employee</label>
                <select
                  required
                  value={form.targetIdentityId}
                  onChange={(e) => setForm({ ...form, targetIdentityId: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md bg-white"
                >
                  {identities.length === 0 && <option value="">No identities available</option>}
                  {identities.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.employee_id} · {i.full_name} ({i.lifecycle_status})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Application</label>
                  <select
                    required
                    value={form.applicationId}
                    onChange={(e) => {
                      const nextApp = e.target.value;
                      const firstE = entitlements.find((ent) => ent.application_id === nextApp)?.id || '';
                      setForm({ ...form, applicationId: nextApp, entitlementId: firstE });
                    }}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md bg-white"
                  >
                    {apps.length === 0 && <option value="">No applications in catalog</option>}
                    {apps.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Entitlement</label>
                  <select
                    required
                    value={form.entitlementId}
                    onChange={(e) => setForm({ ...form, entitlementId: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md bg-white"
                  >
                    {appEnts.length === 0 && <option value="">No entitlements available</option>}
                    {appEnts.map((e) => (
                      <option key={e.id} value={e.id}>{e.name} ({e.sensitivity})</option>
                    ))}
                  </select>
                </div>
              </div>

              {sodPreview && sodPreview.violations && sodPreview.violations.length > 0 && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-800 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">Segregation of Duties Conflict Detected</div>
                    {sodPreview.violations.map((v: any) => (
                      <div key={v.policyId}>
                        {v.policyName} — conflicts with {v.conflictingEntitlementName} (Action: {v.enforcementAction})
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Request Type</label>
                  <select
                    value={form.requestType}
                    onChange={(e) => setForm({ ...form, requestType: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md bg-white"
                  >
                    <option value="New Access">New Access</option>
                    <option value="Additional Permissions">Additional Permissions</option>
                    <option value="Access Modification">Access Modification</option>
                    <option value="Access Revocation">Access Revocation</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Priority</label>
                  <select
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md bg-white"
                  >
                    <option value="low">Low (48h SLA)</option>
                    <option value="medium">Medium (24h SLA)</option>
                    <option value="high">High (12h SLA)</option>
                    <option value="critical">Critical (4h SLA)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Business Justification</label>
                <textarea
                  rows={2}
                  required
                  minLength={5}
                  value={form.businessJustification}
                  onChange={(e) => setForm({ ...form, businessJustification: e.target.value })}
                  placeholder="Describe business need and least-privilege scope..."
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                />
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
                  disabled={!form.targetIdentityId || !form.applicationId || !form.entitlementId}
                  className="px-4 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md disabled:opacity-50"
                >
                  Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Request Approval Drawer */}
      {selectedReq && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex justify-end">
          <div className="bg-white w-full max-w-xl h-full overflow-y-auto p-6 border-l border-slate-200 space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-mono text-xs text-slate-500">
                  {selectedReq.request.request_number} · {selectedReq.request.request_type}
                </div>
                <h3 className="font-display text-lg font-semibold text-slate-900 mt-1">
                  {selectedReq.request.app_name} — {selectedReq.request.ent_name}
                </h3>
                <div className="text-xs text-slate-600 mt-0.5">
                  Target: {selectedReq.request.target_name} ({selectedReq.request.target_email})
                </div>
              </div>
              <button onClick={() => setSelectedReq(null)} className="text-slate-500 hover:text-slate-800">
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-800">
                {error}
              </div>
            )}

            <div className="border border-slate-200 rounded-md p-3 text-xs space-y-1">
              <div><span className="font-semibold">Justification:</span> {selectedReq.request.business_justification}</div>
              <div><span className="font-semibold">Approval Status:</span> <span className={statusTextClass(selectedReq.request.approval_status)}>{selectedReq.request.approval_status}</span></div>
              <div><span className="font-semibold">Provisioning Status:</span> <span className={statusTextClass(selectedReq.request.completion_status)}>{selectedReq.request.completion_status}</span></div>
              {selectedReq.request.rejection_reason && (
                <div className="text-red-700"><span className="font-semibold">Rejection Reason:</span> {selectedReq.request.rejection_reason}</div>
              )}
            </div>

            <div>
              <h4 className="font-display text-sm font-semibold text-slate-900 mb-2">
                Multi-Stage Approval Chain
              </h4>
              <div className="space-y-2">
                {selectedReq.approvals.map((a: any) => (
                  <div key={a.id} className="border border-slate-200 rounded-md p-3 text-xs flex justify-between">
                    <div>
                      <div className="font-semibold text-slate-800 capitalize">
                        {a.stage.replace('_', ' ')} · {a.approver_name}
                      </div>
                      <div className="text-slate-500">{a.approver_role}</div>
                      {a.comments && <div className="mt-1 text-slate-700">Note: {a.comments}</div>}
                    </div>
                    <div className="text-right">
                      <div className={statusTextClass(a.decision)}>{a.decision}</div>
                      {a.decided_at && (
                        <div className="font-mono text-slate-400 mt-0.5">{formatTimestamp(a.decided_at)}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {selectedReq.request.approval_status === 'Pending Approval' && canDecide && (
              <div className="border-t border-slate-200 pt-4 space-y-3">
                <label className="block text-xs font-medium text-slate-700">
                  Approval / Rejection Justification (required for Reject)
                </label>
                <textarea
                  rows={2}
                  value={decisionComment}
                  onChange={(e) => setDecisionComment(e.target.value)}
                  placeholder="Enter review comments..."
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDecision('Approved')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-md"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Approve Current Stage
                  </button>
                  <button
                    onClick={() => handleDecision('Rejected')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-red-700 hover:bg-red-800 rounded-md"
                  >
                    <X className="w-3.5 h-3.5" />
                    Reject Request
                  </button>
                </div>
              </div>
            )}

            {selectedReq.workItems.length > 0 && (
              <div>
                <h4 className="font-display text-sm font-semibold text-slate-900 mb-2">
                  Dispatched Provisioning Work Items
                </h4>
                {selectedReq.workItems.map((w: any) => (
                  <div key={w.id} className="border border-slate-200 rounded-md p-3 text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="font-mono font-semibold">{w.work_item_number} · {w.action}</span>
                      <span className={statusTextClass(w.status)}>{w.status}</span>
                    </div>
                    {w.error_details && <div className="text-red-700 font-mono">{w.error_details}</div>}
                    {w.resolution_notes && <div className="text-slate-600">{w.resolution_notes}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const ProvisioningQueueModule: React.FC<{ user: AuthUser }> = ({ user }) => {
  const [workItems, setWorkItems] = useState<any[]>([]);
  const [directory, setDirectory] = useState<{ idpAccounts: any[]; ldapEntries: any[] } | null>(null);
  const [view, setView] = useState<'queue' | 'directory'>('queue');
  const [notice, setNotice] = useState<string | null>(null);

  const canOperate = user.operator_role === 'iam_admin' || user.operator_role === 'iam_analyst';

  const load = async () => {
    const [wiRes, dirRes] = await Promise.all([
      apiRequest<{ workItems: any[] }>('/api/provisioning/work-items'),
      apiRequest<{ idpAccounts: any[]; ldapEntries: any[] }>('/api/directory/live'),
    ]);
    setWorkItems(wiRes.workItems);
    setDirectory(dirRes);
  };

  useEffect(() => {
    load();
  }, []);

  const executeItem = async (id: string) => {
    setNotice(null);
    const res = await apiRequest<any>(`/api/provisioning/work-items/${id}/execute`, { method: 'POST' });
    if (res.failed) {
      setNotice(`Execution failed: ${res.error} (Linked Incident: ${res.linkedIncident})`);
    } else if (res.idempotentSkip) {
      setNotice('Idempotency guard: Work item already fulfilled; duplicate operation skipped.');
    } else {
      setNotice(`Work item ${res.workItem.work_item_number} provisioned successfully.`);
    }
    await load();
  };

  const escalateItem = async (id: string) => {
    const res = await apiRequest<any>(`/api/provisioning/work-items/${id}/escalate`, {
      method: 'POST',
      body: JSON.stringify({ notes: 'Escalated to L2 IAM Engineering from Provisioning Queue' }),
    });
    setNotice(`Escalated ${res.workItem.work_item_number} to Level 2.`);
    await load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-slate-900">
            Provisioning Orchestration Queue & Directory State
          </h2>
          <p className="text-sm text-slate-600">
            Idempotent SailPoint-style work items synchronized to Keycloak IdP and OpenLDAP directory entries.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
            <button
              onClick={() => setView('queue')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                view === 'queue' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Work-Item Queue
            </button>
            <button
              onClick={() => setView('directory')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                view === 'directory' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Keycloak IdP & OpenLDAP
            </button>
          </div>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-md hover:bg-slate-50"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {notice && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-900">
          {notice}
        </div>
      )}

      {view === 'queue' ? (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Work Item</th>
                  <th className="px-4 py-3 text-left font-medium">Identity</th>
                  <th className="px-4 py-3 text-left font-medium">Action · Target</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Retries</th>
                  <th className="px-4 py-3 text-left font-medium">Error / Resolution</th>
                  <th className="px-4 py-3 text-right font-medium">Operations</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {workItems.map((w) => (
                  <tr key={w.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-mono font-medium text-slate-900">{w.work_item_number}</div>
                      <div className="font-mono text-[11px] text-slate-400">
                        {w.escalated_to_l2 ? 'L2 Escalated' : 'L1 Queue'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{w.target_name}</div>
                      <div className="font-mono text-slate-500">{w.employee_id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-slate-800">{w.action}</div>
                      <div className="text-slate-500">{w.app_name || 'Global Directory'}</div>
                    </td>
                    <td className={`px-4 py-3 ${statusTextClass(w.status)}`}>{w.status}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {w.retry_count} / {w.max_retries}
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      {w.error_details ? (
                        <div className="text-red-700 font-mono text-[11px] break-words">{w.error_details}</div>
                      ) : (
                        <div className="text-slate-600">{w.resolution_notes || 'Awaiting dispatch'}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                      {canOperate && w.status !== 'Fulfilled' && (
                        <>
                          <button
                            onClick={() => executeItem(w.id)}
                            className="inline-flex items-center gap-1 text-blue-700 hover:underline font-medium"
                          >
                            <RotateCcw className="w-3 h-3" />
                            {w.status === 'Failed' ? 'Retry' : 'Execute'}
                          </button>
                          {!w.escalated_to_l2 && (
                            <button
                              onClick={() => escalateItem(w.id)}
                              className="text-amber-700 hover:underline font-medium"
                            >
                              Escalate L2
                            </button>
                          )}
                        </>
                      )}
                      {w.status === 'Fulfilled' && (
                        <span className="text-slate-400 font-mono">Idempotent OK</span>
                      )}
                    </td>
                  </tr>
                ))}
                {workItems.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      No provisioning work items in queue yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h3 className="font-display text-sm font-semibold text-slate-900 mb-3">
              Keycloak IdP Accounts (Realm Sync)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-2 text-left">Username</th>
                    <th className="py-2 text-left">Keycloak ID</th>
                    <th className="py-2 text-left">Realm Roles</th>
                    <th className="py-2 text-left">State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {directory?.idpAccounts.map((idp) => (
                    <tr key={idp.id}>
                      <td className="py-2 font-mono">{idp.username}</td>
                      <td className="py-2 font-mono text-slate-500">{idp.keycloak_user_id}</td>
                      <td className="py-2 font-mono text-[11px]">{idp.realm_roles}</td>
                      <td className={`py-2 ${idp.enabled ? 'text-emerald-700 font-medium' : 'text-red-700 font-medium'}`}>
                        {idp.enabled ? 'Enabled' : 'Disabled'}
                      </td>
                    </tr>
                  ))}
                  {directory?.idpAccounts.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-slate-500">
                        No Keycloak IdP accounts provisioned yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h3 className="font-display text-sm font-semibold text-slate-900 mb-3">
              OpenLDAP Directory Entries
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-2 text-left">Distinguished Name (DN)</th>
                    <th className="py-2 text-left">Title</th>
                    <th className="py-2 text-left">Account Lock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {directory?.ldapEntries.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2 font-mono text-[11px] break-all">{l.dn}</td>
                      <td className="py-2 text-slate-700">{l.title}</td>
                      <td className={`py-2 font-mono ${l.ns_account_lock ? 'text-red-700 font-semibold' : 'text-emerald-700'}`}>
                        {l.ns_account_lock ? 'LOCKED' : 'UNLOCKED'}
                      </td>
                    </tr>
                  ))}
                  {directory?.ldapEntries.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-6 text-center text-slate-500">
                        No OpenLDAP directory entries provisioned yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

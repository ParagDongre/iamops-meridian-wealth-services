import React, { useEffect, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Plus, X } from 'lucide-react';
import { apiRequest, formatTimestamp, statusTextClass, type AuthUser } from '../types';

export const TicketsAndIncidentsModule: React.FC<{ user: AuthUser }> = ({ user }) => {
  const [tickets, setTickets] = useState<any[]>([]);
  const [selected, setSelected] = useState<{ ticket: any; comments: any[] } | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const createEmptyTicketForm = () => ({
    ticketType: 'Incident',
    title: '',
    description: '',
    category: 'Access Issue',
    priority: 'medium',
    assignedAnalyst: 'Marcus Chen',
  });

  const [form, setForm] = useState(createEmptyTicketForm);

  const canOperate = user.operator_role === 'iam_admin' || user.operator_role === 'iam_analyst';

  const load = async () => {
    const res = await apiRequest<{ tickets: any[] }>('/api/tickets');
    setTickets(res.tickets);
  };

  useEffect(() => {
    load();
  }, []);

  const openTicket = async (id: string) => {
    const res = await apiRequest<{ ticket: any; comments: any[] }>(`/api/tickets/${id}`);
    setSelected(res);
    setResolutionNotes(res.ticket.resolution_notes || '');
  };

  const createTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiRequest('/api/tickets', { method: 'POST', body: JSON.stringify(form) });
    setShowCreate(false);
    setForm(createEmptyTicketForm());
    await load();
  };

  const updateTicketStatus = async (status: string) => {
    if (!selected) return;
    await apiRequest(`/api/tickets/${selected.ticket.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, resolutionNotes }),
    });
    await load();
    await openTicket(selected.ticket.id);
  };

  const escalateTicket = async () => {
    if (!selected) return;
    await apiRequest(`/api/tickets/${selected.ticket.id}/escalate`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Manual escalation from ITSM desk' }),
    });
    await load();
    await openTicket(selected.ticket.id);
  };

  const addComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !commentBody.trim()) return;
    await apiRequest(`/api/tickets/${selected.ticket.id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: commentBody }),
    });
    setCommentBody('');
    await openTicket(selected.ticket.id);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-slate-900">
            ITSM Tickets, Incidents & Tasks
          </h2>
          <p className="text-sm text-slate-600">
            Custom ITSM workflow simulation (ServiceNow-inspired Incidents, Service Requests, and Operational Tasks; not an external ServiceNow integration).
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          Create Ticket
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Ticket ID</th>
                <th className="px-4 py-3 text-left font-medium">Type · Category</th>
                <th className="px-4 py-3 text-left font-medium">Summary</th>
                <th className="px-4 py-3 text-left font-medium">Analyst</th>
                <th className="px-4 py-3 text-left font-medium">Priority</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">SLA Deadline</th>
                <th className="px-4 py-3 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tickets.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono font-medium text-slate-900">
                    {t.ticket_number}
                    {t.escalation_level > 1 && <span className="text-red-700 ml-1">L{t.escalation_level}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{t.ticket_type}</div>
                    <div className="text-slate-500">{t.category}</div>
                  </td>
                  <td className="px-4 py-3 max-w-sm">
                    <div className="font-medium text-slate-900 truncate">{t.title}</div>
                    <div className="text-slate-500 truncate">Requestor: {t.requestor}</div>
                  </td>
                  <td className="px-4 py-3">{t.assigned_analyst}</td>
                  <td className={`px-4 py-3 capitalize font-mono ${statusTextClass(t.priority)}`}>{t.priority}</td>
                  <td className={`px-4 py-3 ${statusTextClass(t.status)}`}>{t.status}</td>
                  <td className={`px-4 py-3 font-mono tabular-nums ${t.is_sla_breached ? 'text-red-700 font-semibold' : 'text-slate-600'}`}>
                    {formatTimestamp(t.sla_deadline)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openTicket(t.id)} className="text-blue-700 hover:underline font-medium">
                      Open
                    </button>
                  </td>
                </tr>
              ))}
              {tickets.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    No ITSM tickets recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Ticket Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-lg w-full p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-display text-base font-semibold">New ITSM Ticket</h3>
              <button onClick={() => setShowCreate(false)}><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={createTicket} className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={form.ticketType}
                  onChange={(e) => setForm({ ...form, ticketType: e.target.value })}
                  className="px-3 py-1.5 border border-slate-300 rounded-md bg-white"
                >
                  <option value="Incident">Incident</option>
                  <option value="Service Request">Service Request</option>
                  <option value="Operational Task">Operational Task</option>
                </select>
                <select
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  className="px-3 py-1.5 border border-slate-300 rounded-md bg-white"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <input
                required
                placeholder="Ticket Summary Title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
              />
              <textarea
                required
                rows={3}
                placeholder="Detailed description..."
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  required
                  placeholder="Category"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="px-3 py-1.5 border border-slate-300 rounded-md"
                />
                <input
                  required
                  placeholder="Assigned Analyst"
                  value={form.assignedAnalyst}
                  onChange={(e) => setForm({ ...form, assignedAnalyst: e.target.value })}
                  className="px-3 py-1.5 border border-slate-300 rounded-md"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-xs border border-slate-300 rounded-md">Cancel</button>
                <button type="submit" className="px-4 py-1.5 text-xs bg-blue-700 text-white rounded-md">Submit Ticket</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Ticket Detail Drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex justify-end">
          <div className="bg-white w-full max-w-xl h-full overflow-y-auto p-6 border-l border-slate-200 space-y-5">
            <div className="flex justify-between items-start">
              <div>
                <div className="font-mono text-xs text-slate-500">
                  {selected.ticket.ticket_number} · {selected.ticket.ticket_type} · Level {selected.ticket.escalation_level}
                </div>
                <h3 className="font-display text-lg font-semibold text-slate-900 mt-1">{selected.ticket.title}</h3>
              </div>
              <button onClick={() => setSelected(null)}><X className="w-5 h-5 text-slate-500" /></button>
            </div>

            <div className="border border-slate-200 rounded-md p-3 text-xs space-y-1.5">
              <div><span className="font-semibold">Status:</span> <span className={statusTextClass(selected.ticket.status)}>{selected.ticket.status}</span></div>
              <div><span className="font-semibold">Analyst:</span> {selected.ticket.assigned_analyst}</div>
              <div><span className="font-semibold">SLA Deadline:</span> <span className="font-mono">{formatTimestamp(selected.ticket.sla_deadline)}</span></div>
              <div className="pt-1 text-slate-700 whitespace-pre-wrap">{selected.ticket.description}</div>
            </div>

            {canOperate && (
              <div className="border-t border-slate-200 pt-4 space-y-3 text-xs">
                <textarea
                  rows={2}
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  placeholder="Resolution notes..."
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                />
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => updateTicketStatus('In Progress')} className="px-3 py-1.5 border border-slate-300 rounded hover:bg-slate-50">In Progress</button>
                  <button onClick={() => updateTicketStatus('Resolved')} className="px-3 py-1.5 bg-emerald-700 text-white rounded hover:bg-emerald-800">Resolve</button>
                  <button onClick={() => updateTicketStatus('Closed')} className="px-3 py-1.5 bg-slate-800 text-white rounded">Close</button>
                  <button onClick={escalateTicket} className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-700 text-white rounded hover:bg-red-800">
                    <ArrowUpRight className="w-3.5 h-3.5" /> Escalate
                  </button>
                </div>
              </div>
            )}

            <div className="border-t border-slate-200 pt-4 space-y-3">
              <h4 className="font-display text-sm font-semibold">Activity & Work Notes</h4>
              <div className="space-y-2">
                {selected.comments.map((c) => (
                  <div key={c.id} className="bg-slate-50 border border-slate-200 rounded p-2.5 text-xs">
                    <div className="flex justify-between text-slate-500 font-mono">
                      <span>{c.author}</span>
                      <span>{formatTimestamp(c.created_at)}</span>
                    </div>
                    <div className="mt-1 text-slate-800">{c.body}</div>
                  </div>
                ))}
              </div>
              <form onSubmit={addComment} className="flex gap-2">
                <input
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  placeholder="Add work note..."
                  className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                />
                <button type="submit" className="px-3 py-1.5 text-xs bg-blue-700 text-white rounded-md">Post</button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const AccessCertificationModule: React.FC<{ user: AuthUser }> = ({ user }) => {
  const [data, setData] = useState<{ campaigns: any[]; items: any[] } | null>(null);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [decision, setDecision] = useState<'Certified' | 'Revoked' | 'Investigate' | 'Inappropriate'>('Certified');
  const [justification, setJustification] = useState('');
  const [showNewCamp, setShowNewCamp] = useState(false);
  const [campForm, setCampForm] = useState({
    name: '',
    description: '',
    scope: 'high_critical',
    dueDays: 14,
  });

  const canReview = ['iam_admin', 'manager', 'app_owner', 'auditor'].includes(user.operator_role);

  const load = async () => {
    const res = await apiRequest<{ campaigns: any[]; items: any[] }>('/api/certifications');
    setData(res);
  };

  useEffect(() => {
    load();
  }, []);

  const submitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;
    await apiRequest(`/api/certifications/items/${selectedItem.id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ decision, justification }),
    });
    setSelectedItem(null);
    setJustification('');
    await load();
  };

  const createCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiRequest('/api/certifications/campaigns', {
      method: 'POST',
      body: JSON.stringify(campForm),
    });
    setShowNewCamp(false);
    setCampForm({ name: '', description: '', scope: 'high_critical', dueDays: 14 });
    await load();
  };

  if (!data) return <div className="text-sm text-slate-500">Loading certification campaigns...</div>;

  const total = data.items.length;
  const certified = data.items.filter((i) => i.decision === 'Certified').length;
  const revoked = data.items.filter((i) => i.decision === 'Revoked' || i.decision === 'Inappropriate').length;
  const pending = data.items.filter((i) => i.decision === 'Pending').length;
  const overdue = data.items.filter((i) => i.is_overdue === 1 && i.decision === 'Pending').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-slate-900">
            Access Certification & Periodic Reviews
          </h2>
          <p className="text-sm text-slate-600">
            Manager and application-owner attestation campaigns. Revocations automatically trigger deprovisioning work items.
          </p>
        </div>
        {['iam_admin', 'auditor', 'manager'].includes(user.operator_role) && (
          <button
            onClick={() => setShowNewCamp(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            Launch Review Campaign
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {[
          ['Total Assignments', total, 'text-slate-900'],
          ['Certified', certified, 'text-emerald-700'],
          ['Revoked / Flagged', revoked, 'text-red-700'],
          ['Pending Reviews', pending, 'text-amber-700'],
          ['Overdue Reviews', overdue, overdue > 0 ? 'text-red-700' : 'text-slate-900'],
        ].map(([label, val, tone]) => (
          <div key={String(label)} className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="text-xs text-slate-500">{label}</div>
            <div className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${tone}`}>{val}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Identity</th>
                <th className="px-4 py-3 text-left font-medium">Application · Entitlement</th>
                <th className="px-4 py-3 text-left font-medium">Assigned Reviewer</th>
                <th className="px-4 py-3 text-left font-medium">Decision</th>
                <th className="px-4 py-3 text-left font-medium">Justification</th>
                <th className="px-4 py-3 text-right font-medium">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{item.identity_name}</div>
                    <div className="text-slate-500">{item.department}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-slate-800">{item.app_name}</div>
                    <div className="text-slate-500">{item.ent_name} ({item.sensitivity})</div>
                  </td>
                  <td className="px-4 py-3">{item.reviewer_name}</td>
                  <td className={`px-4 py-3 ${statusTextClass(item.decision)}`}>
                    {item.decision}
                    {item.is_overdue === 1 && item.decision === 'Pending' ? ' (OVERDUE)' : ''}
                  </td>
                  <td className="px-4 py-3 max-w-xs text-slate-600">{item.justification || '—'}</td>
                  <td className="px-4 py-3 text-right">
                    {canReview && (
                      <button
                        onClick={() => {
                          setSelectedItem(item);
                          setDecision('Certified');
                          setJustification('');
                        }}
                        className="inline-flex items-center gap-1 text-blue-700 hover:underline font-medium"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Attest
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No access certification assignments yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-md w-full p-6">
            <h3 className="font-display text-base font-semibold text-slate-900">
              Certify or Revoke Access Assignment
            </h3>
            <p className="text-xs text-slate-600 mt-1">
              {selectedItem.identity_name} · {selectedItem.app_name} — {selectedItem.ent_name}
            </p>
            <form onSubmit={submitReview} className="mt-4 space-y-3 text-sm">
              <select
                value={decision}
                onChange={(e) => setDecision(e.target.value as any)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-md bg-white"
              >
                <option value="Certified">Approve / Certify Access</option>
                <option value="Revoked">Revoke Access (Auto-Deprovision)</option>
                <option value="Investigate">Request Investigation</option>
                <option value="Inappropriate">Mark Inappropriate (Auto-Deprovision)</option>
              </select>
              <textarea
                required
                minLength={3}
                rows={3}
                placeholder="Provide review justification (audit evidence)..."
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setSelectedItem(null)} className="px-3 py-1.5 text-xs border border-slate-300 rounded-md">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-1.5 text-xs bg-blue-700 text-white rounded-md">
                  Record Decision
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showNewCamp && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-md w-full p-6">
            <h3 className="font-display text-base font-semibold text-slate-900 mb-3">
              Launch Access Certification Campaign
            </h3>
            <form onSubmit={createCampaign} className="space-y-3 text-sm">
              <input
                required
                placeholder="Campaign Name (e.g. Q1 2027 Privilege Audit)"
                value={campForm.name}
                onChange={(e) => setCampForm({ ...campForm, name: e.target.value })}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
              />
              <select
                value={campForm.scope}
                onChange={(e) => setCampForm({ ...campForm, scope: e.target.value })}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-md bg-white"
              >
                <option value="high_critical">High & Critical Sensitivity Entitlements</option>
                <option value="all_active">All Active Entitlements</option>
              </select>
              <textarea
                required
                rows={2}
                placeholder="Campaign scope and compliance notes..."
                value={campForm.description}
                onChange={(e) => setCampForm({ ...campForm, description: e.target.value })}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowNewCamp(false)} className="px-3 py-1.5 text-xs border border-slate-300 rounded-md">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-1.5 text-xs bg-blue-700 text-white rounded-md">
                  Launch Campaign
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

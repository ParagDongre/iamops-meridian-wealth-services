import React, { useEffect, useState } from 'react';
import { RefreshCw, Play, Trash2 } from 'lucide-react';
import { apiRequest, formatTimestamp, statusTextClass, type AuthUser } from '../types';

interface OverviewData {
  kpis: {
    activeIdentities: number;
    totalIdentities: number;
    pendingRequests: number;
    awaitingApproval: number;
    totalWorkItems: number;
    queuedWorkItems: number;
    successfulProvisioning: number;
    failedProvisioning: number;
    openTickets: number;
    slaCompliancePct: number;
    avgFulfillmentHours: number;
    overdueRequests: number;
    accessReviewCompletionPct: number;
    openSodViolations: number;
  };
  charts: {
    requestVolumeByDay: Array<{ day: string; count: number }>;
    provisioningTrends: Array<{ day: string; fulfilled: number; failed: number; queued: number }>;
    ticketPriorityDistribution: Array<{ priority: string; count: number }>;
    slaByApplication: Array<{ application: string; total_requests: number; on_time: number; breached: number }>;
    workItemAgeing: Array<{
      work_item_number: string;
      action: string;
      status: string;
      priority: string;
      retry_count: number;
      escalated_to_l2: number;
      is_sla_breached: number;
      age_hours: number;
    }>;
    analystWorkload: Array<{
      analyst: string;
      total_tickets: number;
      active_tickets: number;
      breached_tickets: number;
    }>;
  };
}

export const ExecutiveOverview: React.FC<{ onNavigate: (mod: any) => void; user: AuthUser }> = ({
  onNavigate,
  user,
}) => {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mutatingData, setMutatingData] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<OverviewData>('/api/dashboard/overview');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-24 bg-white border border-slate-200 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
        {error || 'No dashboard data available'}
      </div>
    );
  }

  const { kpis, charts } = data;
  const maxReqDay = Math.max(1, ...charts.requestVolumeByDay.map((d) => d.count));
  const maxTicketPrio = Math.max(1, ...charts.ticketPriorityDistribution.map((d) => d.count));
  const hasAnyData =
    kpis.totalIdentities > 0 ||
    kpis.totalWorkItems > 0 ||
    kpis.openTickets > 0 ||
    kpis.pendingRequests > 0 ||
    charts.slaByApplication.length > 0;

  const kpiCards = [
    { label: 'Active Identities', value: kpis.activeIdentities, sub: `of ${kpis.totalIdentities} total`, target: 'identities' },
    { label: 'Pending Requests', value: kpis.pendingRequests, sub: `${kpis.awaitingApproval} awaiting approval`, target: 'requests' },
    { label: 'Awaiting Approval', value: kpis.awaitingApproval, sub: 'Manager / Owner / Compliance', target: 'requests' },
    { label: 'Provisioning Work Items', value: kpis.totalWorkItems, sub: `${kpis.queuedWorkItems} queued`, target: 'provisioning' },
    { label: 'Successful Provisioning', value: kpis.successfulProvisioning, sub: 'Idempotent fulfilled', target: 'provisioning', tone: 'text-emerald-700' },
    { label: 'Failed Provisioning', value: kpis.failedProvisioning, sub: 'Requires retry / L2 review', target: 'provisioning', tone: kpis.failedProvisioning > 0 ? 'text-red-700' : 'text-slate-900' },
    { label: 'Open ITSM Tickets', value: kpis.openTickets, sub: 'Incidents · Requests · Tasks', target: 'tickets' },
    { label: 'SLA Compliance', value: `${kpis.slaCompliancePct}%`, sub: 'Requests within deadline', target: 'sla', tone: kpis.slaCompliancePct >= 90 ? 'text-emerald-700' : 'text-amber-700' },
    { label: 'Avg Fulfillment Time', value: `${kpis.avgFulfillmentHours}h`, sub: 'Request submit to fulfill', target: 'sla' },
    { label: 'Overdue Requests', value: kpis.overdueRequests, sub: 'SLA breached & open', target: 'sla', tone: kpis.overdueRequests > 0 ? 'text-red-700' : 'text-slate-900' },
    { label: 'Access Review Progress', value: `${kpis.accessReviewCompletionPct}%`, sub: 'Certification attested', target: 'certification' },
    { label: 'Open SoD Violations', value: kpis.openSodViolations, sub: 'Policy conflicts tracked', target: 'catalog', tone: kpis.openSodViolations > 0 ? 'text-amber-700' : 'text-slate-900' },
  ];

  const handleLoadDummy = async () => {
    setMutatingData(true);
    setNotice(null);
    setError(null);
    try {
      const res = await apiRequest<{ message: string }>('/api/system/load-dummy-data', { method: 'POST' });
      setNotice(res.message);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dummy data');
    } finally {
      setMutatingData(false);
    }
  };

  const handleClearAll = async () => {
    setMutatingData(true);
    setNotice(null);
    setError(null);
    try {
      const res = await apiRequest<{ message: string }>('/api/system/clear-data', { method: 'POST' });
      setNotice(res.message);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear workspace data');
    } finally {
      setMutatingData(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-slate-900">
            Executive IAM Operations Overview
          </h2>
          <p className="text-sm text-slate-600">
            Live metrics computed directly from Meridian Wealth Services identity, provisioning, ITSM, and governance records.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {user.operator_role === 'iam_admin' && hasAnyData && (
            <button
              disabled={mutatingData}
              onClick={handleClearAll}
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-red-700 bg-white border border-red-300 rounded-md hover:bg-red-50 whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {mutatingData ? 'Clearing...' : 'Clear All Data'}
            </button>
          )}
          <button
            onClick={load}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh Metrics
          </button>
        </div>
      </div>

      {notice && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md text-xs text-emerald-900">
          {notice}
        </div>
      )}

      {!hasAnyData && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-display text-sm font-semibold text-slate-900">
              Clean Workspace — Zero Sample Records Loaded
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              Start by adding applications and roles in App & Catalog Admin, or load the included test dataset (data/dummy-data.json).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onNavigate('catalog')}
              className="px-3 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              Open Catalog Admin
            </button>
            {user.operator_role === 'iam_admin' && (
              <button
                disabled={mutatingData}
                onClick={handleLoadDummy}
                className="px-3 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                {mutatingData ? 'Loading Dummy Data...' : 'Load data/dummy-data.json'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* 12 Live KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
        {kpiCards.map((k) => (
          <button
            key={k.label}
            type="button"
            onClick={() => onNavigate(k.target)}
            className="text-left bg-white border border-slate-200 rounded-lg p-4 hover:border-blue-400 transition-colors"
          >
            <div className="text-xs font-medium text-slate-500 truncate">{k.label}</div>
            <div className={`mt-1.5 font-mono text-2xl font-semibold tabular-nums ${k.tone || 'text-slate-900'}`}>
              {k.value}
            </div>
            <div className="mt-1 text-xs text-slate-500 truncate">{k.sub}</div>
          </button>
        ))}
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h3 className="font-display text-sm font-semibold text-slate-900">Request Volume by Day</h3>
          <p className="text-xs text-slate-500 mb-4">Daily access requests recorded in database</p>
          {charts.requestVolumeByDay.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">No access request records yet.</p>
          ) : (
            <div className="space-y-2.5">
              {charts.requestVolumeByDay.map((d) => (
                <div key={d.day} className="flex items-center gap-3 text-xs">
                  <span className="w-24 font-mono tabular-nums text-slate-600 shrink-0">{d.day}</span>
                  <div className="flex-1 bg-slate-100 h-5 rounded overflow-hidden">
                    <div
                      className="bg-blue-700 h-full transition-all"
                      style={{ width: `${Math.max(8, (d.count / maxReqDay) * 100)}%` }}
                    />
                  </div>
                  <span className="w-8 text-right font-mono tabular-nums font-medium text-slate-800">
                    {d.count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Provisioning Success vs. Failure Trends
          </h3>
          <p className="text-xs text-slate-500 mb-4">Connector work-item outcomes by day</p>
          {charts.provisioningTrends.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">No provisioning work items yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 text-left font-medium">Date</th>
                    <th className="py-2 text-right font-medium">Fulfilled</th>
                    <th className="py-2 text-right font-medium">Failed</th>
                    <th className="py-2 text-right font-medium">Queued</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {charts.provisioningTrends.map((t) => (
                    <tr key={t.day}>
                      <td className="py-2 font-mono tabular-nums text-slate-700">{t.day}</td>
                      <td className="py-2 text-right font-mono tabular-nums text-emerald-700 font-medium">
                        {t.fulfilled}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums text-red-700 font-medium">
                        {t.failed}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums text-amber-700 font-medium">
                        {t.queued}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            SLA Performance by Application
          </h3>
          <p className="text-xs text-slate-500 mb-4">On-time vs. SLA-breached requests per app</p>
          {charts.slaByApplication.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">No applications registered in catalog yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 text-left font-medium">Application</th>
                    <th className="py-2 text-right font-medium">Total</th>
                    <th className="py-2 text-right font-medium">On Time</th>
                    <th className="py-2 text-right font-medium">Breached</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {charts.slaByApplication.map((row) => (
                    <tr key={row.application}>
                      <td className="py-2 text-slate-800 font-medium">{row.application}</td>
                      <td className="py-2 text-right font-mono tabular-nums">{row.total_requests}</td>
                      <td className="py-2 text-right font-mono tabular-nums text-emerald-700">{row.on_time}</td>
                      <td className={`py-2 text-right font-mono tabular-nums ${row.breached > 0 ? 'text-red-700 font-semibold' : 'text-slate-500'}`}>
                        {row.breached}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Ticket Priority Distribution & Analyst Workload
          </h3>
          <p className="text-xs text-slate-500 mb-4">Custom ITSM simulation workload breakdown</p>
          {charts.ticketPriorityDistribution.length === 0 && charts.analystWorkload.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">No ITSM tickets recorded yet.</p>
          ) : (
            <>
              <div className="space-y-2 mb-5">
                {charts.ticketPriorityDistribution.map((p) => (
                  <div key={p.priority} className="flex items-center gap-3 text-xs">
                    <span className="w-20 capitalize font-medium text-slate-700">{p.priority}</span>
                    <div className="flex-1 bg-slate-100 h-4 rounded overflow-hidden">
                      <div
                        className={`h-full ${
                          p.priority === 'critical'
                            ? 'bg-red-600'
                            : p.priority === 'high'
                              ? 'bg-amber-600'
                              : 'bg-slate-700'
                        }`}
                        style={{ width: `${Math.max(10, (p.count / maxTicketPrio) * 100)}%` }}
                      />
                    </div>
                    <span className="w-8 text-right font-mono tabular-nums font-medium">{p.count}</span>
                  </div>
                ))}
              </div>
              <div className="pt-3 border-t border-slate-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-200">
                      <th className="py-1.5 text-left font-medium">Analyst</th>
                      <th className="py-1.5 text-right font-medium">Active</th>
                      <th className="py-1.5 text-right font-medium">Breached</th>
                      <th className="py-1.5 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {charts.analystWorkload.map((a) => (
                      <tr key={a.analyst}>
                        <td className="py-1.5 text-slate-800">{a.analyst}</td>
                        <td className="py-1.5 text-right font-mono tabular-nums">{a.active_tickets}</td>
                        <td className={`py-1.5 text-right font-mono tabular-nums ${a.breached_tickets > 0 ? 'text-red-700' : 'text-slate-500'}`}>
                          {a.breached_tickets}
                        </td>
                        <td className="py-1.5 text-right font-mono tabular-nums">{a.total_tickets}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Work-item Ageing */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h3 className="font-display text-sm font-semibold text-slate-900">
          Open Provisioning Work-Item Ageing
        </h3>
        <p className="text-xs text-slate-500 mb-3">
          Unfulfilled provisioning items sorted by age in hours
        </p>
        {charts.workItemAgeing.length === 0 ? (
          <p className="text-xs text-slate-500 py-4">All provisioning work items are currently fulfilled.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 text-left font-medium">Work Item</th>
                  <th className="py-2 text-left font-medium">Action</th>
                  <th className="py-2 text-left font-medium">Status</th>
                  <th className="py-2 text-right font-medium">Retries</th>
                  <th className="py-2 text-left font-medium">L2 Escalated</th>
                  <th className="py-2 text-right font-medium">Age (hrs)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {charts.workItemAgeing.map((w) => (
                  <tr key={w.work_item_number}>
                    <td className="py-2 font-mono font-medium text-slate-900">{w.work_item_number}</td>
                    <td className="py-2 font-mono text-slate-700">{w.action}</td>
                    <td className={`py-2 ${statusTextClass(w.status)}`}>{w.status}</td>
                    <td className="py-2 text-right font-mono tabular-nums">{w.retry_count}</td>
                    <td className="py-2 text-slate-700">{w.escalated_to_l2 ? 'Yes (L2)' : 'No'}</td>
                    <td className="py-2 text-right font-mono tabular-nums">{w.age_hours}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export const SlaReportsModule: React.FC<{ user: AuthUser }> = ({ user }) => {
  const [report, setReport] = useState<{
    sweeps: any[];
    overdueRequests: any[];
    overdueWorkItems: any[];
    overdueTickets: any[];
  } | null>(null);
  const [sweepNotice, setSweepNotice] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const load = async () => {
    const res = await apiRequest<any>('/api/sla/report');
    setReport(res);
  };

  useEffect(() => {
    load();
  }, []);

  const triggerSweep = async () => {
    setRunning(true);
    setSweepNotice(null);
    try {
      const res = await apiRequest<any>('/api/sla/sweep', { method: 'POST' });
      setSweepNotice(
        `SLA Sweep ${res.runId} completed: flagged ${res.breachedRequests} request(s), ${res.breachedWorkItems} work item(s), ${res.breachedTickets} ticket(s), and ${res.overdueCertifications} certification(s).`
      );
      await load();
    } catch (err) {
      setSweepNotice(err instanceof Error ? err.message : 'SLA sweep failed');
    } finally {
      setRunning(false);
    }
  };

  const canSweep = user.operator_role === 'iam_admin' || user.operator_role === 'iam_analyst';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-slate-900">
            SLA & Performance Operations Reports
          </h2>
          <p className="text-sm text-slate-600">
            Automated SLA breach detection calculated from persisted UTC deadlines and escalation logs.
          </p>
        </div>
        {canSweep && (
          <button
            onClick={triggerSweep}
            disabled={running}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            {running ? 'Running SLA Sweep...' : 'Run Live SLA Breach Sweep'}
          </button>
        )}
      </div>

      {sweepNotice && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-900">
          {sweepNotice}
        </div>
      )}

      {report && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs text-slate-500">Overdue Access Requests</div>
              <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-red-700">
                {report.overdueRequests.length}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs text-slate-500">Overdue Provisioning Work Items</div>
              <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-red-700">
                {report.overdueWorkItems.length}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs text-slate-500">Breached ITSM Tickets</div>
              <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-red-700">
                {report.overdueTickets.length}
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h3 className="font-display text-sm font-semibold text-slate-900 mb-3">
              Breached Requests & Work Items
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 text-left font-medium">Reference</th>
                    <th className="py-2 text-left font-medium">Type</th>
                    <th className="py-2 text-left font-medium">Target / Summary</th>
                    <th className="py-2 text-left font-medium">SLA Deadline</th>
                    <th className="py-2 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.overdueRequests.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2 font-mono font-medium">{r.request_number}</td>
                      <td className="py-2">Access Request</td>
                      <td className="py-2">{r.target_name} · {r.app_name} ({r.ent_name})</td>
                      <td className="py-2 font-mono tabular-nums text-red-700">{formatTimestamp(r.sla_deadline)}</td>
                      <td className={`py-2 ${statusTextClass(r.approval_status)}`}>{r.approval_status}</td>
                    </tr>
                  ))}
                  {report.overdueWorkItems.map((w) => (
                    <tr key={w.id}>
                      <td className="py-2 font-mono font-medium">{w.work_item_number}</td>
                      <td className="py-2">Work Item</td>
                      <td className="py-2">{w.target_name} · {w.action}</td>
                      <td className="py-2 font-mono tabular-nums text-red-700">{formatTimestamp(w.sla_deadline)}</td>
                      <td className={`py-2 ${statusTextClass(w.status)}`}>{w.status}</td>
                    </tr>
                  ))}
                  {report.overdueTickets.map((t) => (
                    <tr key={t.id}>
                      <td className="py-2 font-mono font-medium">{t.ticket_number}</td>
                      <td className="py-2">{t.ticket_type}</td>
                      <td className="py-2">{t.title}</td>
                      <td className="py-2 font-mono tabular-nums text-red-700">{formatTimestamp(t.sla_deadline)}</td>
                      <td className={`py-2 ${statusTextClass(t.status)}`}>{t.status}</td>
                    </tr>
                  ))}
                  {report.overdueRequests.length + report.overdueWorkItems.length + report.overdueTickets.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-500">
                        No SLA breaches currently open.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h3 className="font-display text-sm font-semibold text-slate-900 mb-3">
              Recent SLA Sweep Executions
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 text-left font-medium">Run ID</th>
                    <th className="py-2 text-left font-medium">Timestamp</th>
                    <th className="py-2 text-left font-medium">Triggered By</th>
                    <th className="py-2 text-right font-medium">Requests</th>
                    <th className="py-2 text-right font-medium">Work Items</th>
                    <th className="py-2 text-right font-medium">Tickets</th>
                    <th className="py-2 text-right font-medium">Certs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.sweeps.map((s) => (
                    <tr key={s.id}>
                      <td className="py-2 font-mono">{s.id}</td>
                      <td className="py-2 font-mono tabular-nums">{formatTimestamp(s.ran_at)}</td>
                      <td className="py-2">{s.triggered_by}</td>
                      <td className="py-2 text-right font-mono tabular-nums">{s.breached_requests}</td>
                      <td className="py-2 text-right font-mono tabular-nums">{s.breached_work_items}</td>
                      <td className="py-2 text-right font-mono tabular-nums">{s.breached_tickets}</td>
                      <td className="py-2 text-right font-mono tabular-nums">{s.overdue_certifications}</td>
                    </tr>
                  ))}
                  {report.sweeps.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-slate-500">
                        No manual or scheduled SLA sweeps recorded yet.
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

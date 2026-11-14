import React, { useEffect, useState } from 'react';
import { Download, ShieldCheck, CheckCircle, Key, FileText, Database, Trash2, Upload } from 'lucide-react';
import { apiRequest, formatTimestamp, statusTextClass, type AuthUser } from '../types';

export const AuditComplianceModule: React.FC = () => {
  const [events, setEvents] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [verifyResult, setVerifyResult] = useState<{
    valid: boolean;
    checkedCount: number;
    message: string;
  } | null>(null);

  const load = async () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (category !== 'All') params.set('category', category);
    const res = await apiRequest<{ events: any[] }>(`/api/audit/events?${params.toString()}`);
    setEvents(res.events);
  };

  useEffect(() => {
    load();
  }, [search, category]);

  const verifyChain = async () => {
    const res = await apiRequest<{ valid: boolean; checkedCount: number; message: string }>(
      '/api/audit/verify'
    );
    setVerifyResult(res);
  };

  const downloadCsv = async (type: string) => {
    const token = localStorage.getItem('iamops_token');
    const res = await fetch(`/api/audit/export/${type}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const text = await res.text();
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meridian-iamops-${type}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-slate-900">
            Audit Log & Compliance Evidence
          </h2>
          <p className="text-sm text-slate-600">
            Append-only SHA-256 hash-chained audit trail protected by database immutability triggers.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={verifyChain}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md whitespace-nowrap"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Verify Hash Chain
          </button>
          {[
            ['audit', 'Audit CSV'],
            ['access_reviews', 'Reviews CSV'],
            ['failed_provisioning', 'Failures CSV'],
            ['sod_violations', 'SoD CSV'],
          ].map(([t, label]) => (
            <button
              key={t}
              onClick={() => downloadCsv(t)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {verifyResult && (
        <div
          className={`p-3 border rounded-md text-xs flex items-center gap-2 ${
            verifyResult.valid
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{verifyResult.message}</span>
        </div>
      )}

      {/* Implemented vs Simulated Controls Transparency Matrix */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h3 className="font-display text-sm font-semibold text-slate-900 mb-2">
          Control Scope Transparency (Implemented vs. Simulated)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div>
            <div className="font-semibold text-emerald-800 mb-1">Actually Implemented Controls</div>
            <ul className="space-y-1 text-slate-600 list-disc pl-4">
              <li>Scrypt password hashing, 5-attempt lockout, IP rate limit, 30m revocable JWTs, TOTP MFA</li>
              <li>Backend-enforced RBAC, SoD dual-control conflict blocking, and multi-stage approval gating</li>
              <li>Append-only SHA-256 hash-chained audit table with SQLite UPDATE/DELETE abort triggers</li>
              <li>Idempotent work-item orchestration & Leaver zero-privilege-retention verification</li>
            </ul>
          </div>
          <div>
            <div className="font-semibold text-amber-800 mb-1">Simulated / Lab Integrations</div>
            <ul className="space-y-1 text-slate-600 list-disc pl-4">
              <li>ITSM Ticketing is a custom ServiceNow-inspired workflow simulation (not external ServiceNow API)</li>
              <li>Provisioning Queue mirrors SailPoint IIQ work-item patterns (not SailPoint IdentityNow)</li>
              <li>Keycloak & OpenLDAP operate via embedded persistent tables unless KEYCLOAK_URL is configured</li>
              <li>Audit logs provide technical evidence only and do not constitute formal SOC 2 / SOX certification</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search actor, target identity, action, or request ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[220px] px-3 py-1.5 text-sm border border-slate-300 rounded-md"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white"
        >
          {['All', 'identity', 'jml', 'access_request', 'approval', 'provisioning', 'rbac_sod', 'ticket', 'certification', 'security', 'catalog', 'sla'].map(
            (c) => (
              <option key={c} value={c}>{c === 'All' ? 'All Categories' : c}</option>
            )
          )}
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Event ID · Timestamp</th>
                <th className="px-4 py-3 text-left font-medium">Actor</th>
                <th className="px-4 py-3 text-left font-medium">Target</th>
                <th className="px-4 py-3 text-left font-medium">Category · Action</th>
                <th className="px-4 py-3 text-left font-medium">Outcome</th>
                <th className="px-4 py-3 text-left font-medium">SHA-256 Hash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {events.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-mono">
                    <div className="font-medium text-slate-900">{e.id}</div>
                    <div className="text-slate-500 text-[11px]">{formatTimestamp(e.timestamp)}</div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-slate-700">{e.actor}</td>
                  <td className="px-4 py-2.5 font-mono text-slate-700">{e.target_identity}</td>
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-slate-500 mr-1.5">[{e.category}]</span>
                    <span className="text-slate-900">{e.action}</span>
                  </td>
                  <td className={`px-4 py-2.5 ${statusTextClass(e.outcome)}`}>{e.outcome}</td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-slate-400">
                    {String(e.event_hash).slice(0, 14)}…
                  </td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No audit events recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export const SystemConfigModule: React.FC<{ user: AuthUser; onRefreshUser: () => void }> = ({
  user,
  onRefreshUser,
}) => {
  const [health, setHealth] = useState<any | null>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; otpauthUri: string; currentSampleCode?: string } | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [docsList, setDocsList] = useState<string[]>([]);
  const [activeDoc, setActiveDoc] = useState<{ file: string; content: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    const [h, s, d] = await Promise.all([
      apiRequest('/health/ready'),
      apiRequest<{ sessions: any[] }>('/api/auth/sessions'),
      apiRequest<{ docs: string[] }>('/api/docs/list'),
    ]);
    setHealth(h);
    setSessions(s.sessions);
    setDocsList(d.docs);
  };

  useEffect(() => {
    load();
  }, []);

  const startMfaEnroll = async () => {
    const res = await apiRequest<any>('/api/auth/mfa/enroll', { method: 'POST' });
    setMfaSetup(res);
  };

  const confirmMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiRequest('/api/auth/mfa/verify-setup', {
      method: 'POST',
      body: JSON.stringify({ code: mfaCode }),
    });
    setMfaSetup(null);
    setMfaCode('');
    setNotice('TOTP MFA enabled on your operator account.');
    onRefreshUser();
  };

  const revokeSession = async (jti: string) => {
    await apiRequest(`/api/auth/sessions/${jti}/revoke`, { method: 'POST' });
    setNotice(`Session ${jti.slice(0, 8)} revoked.`);
    await load();
  };

  const openDoc = async (file: string) => {
    const res = await apiRequest<{ file: string; content: string }>(
      `/api/docs/content?file=${encodeURIComponent(file)}`
    );
    setActiveDoc(res);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-semibold text-slate-900">
          System Configuration, Security & Architecture
        </h2>
        <p className="text-sm text-slate-600">
          Runtime readiness, TOTP MFA enrollment, active JWT revocation, system architecture topology, and operations documentation.
        </p>
      </div>

      {notice && <div className="p-3 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-800">{notice}</div>}

      {/* Lab Test Data Management (data/dummy-data.json) */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Lab Test Data Management (data/dummy-data.json)
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              Download the dummy dataset JSON, load it into the database for end-to-end testing, upload custom JSON, or clear all records back to zero.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={async () => {
                const token = localStorage.getItem('iamops_token');
                const res = await fetch('/api/system/dummy-data', {
                  headers: token ? { Authorization: `Bearer ${token}` } : {},
                });
                const text = await res.text();
                const blob = new Blob([text], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'dummy-data.json';
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Download dummy-data.json
            </button>

            {user.operator_role === 'iam_admin' && (
              <>
                <button
                  onClick={async () => {
                    const res = await apiRequest<{ message: string }>('/api/system/load-dummy-data', {
                      method: 'POST',
                    });
                    setNotice(res.message);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap"
                >
                  <Database className="w-3.5 h-3.5" />
                  Load Dummy Data
                </button>

                <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer whitespace-nowrap">
                  <Upload className="w-3.5 h-3.5" />
                  Import Custom JSON
                  <input
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        const json = JSON.parse(await file.text());
                        const res = await apiRequest<{ message: string }>('/api/system/load-dummy-data', {
                          method: 'POST',
                          body: JSON.stringify(json),
                        });
                        setNotice(res.message);
                      } catch (err) {
                        setNotice(err instanceof Error ? err.message : 'Invalid JSON dummy file');
                      }
                      e.target.value = '';
                    }}
                  />
                </label>

                <button
                  onClick={async () => {
                    const res = await apiRequest<{ message: string }>('/api/system/clear-data', {
                      method: 'POST',
                    });
                    setNotice(res.message);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 bg-white border border-red-300 rounded-md hover:bg-red-50 whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear All Data (Zero Reset)
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Readiness + MFA */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-lg p-5 text-xs space-y-2">
          <h3 className="font-display text-sm font-semibold text-slate-900 mb-2">
            Service Readiness & Connector Topology
          </h3>
          {health && (
            <div className="space-y-1.5 font-mono text-slate-700">
              <div>Status: <span className="text-emerald-700 font-semibold">{health.status}</span></div>
              <div>Environment: {health.env}</div>
              <div>Database: {health.database}</div>
              <div>Keycloak Adapter: {health.keycloakMode}</div>
              <div>OpenLDAP Adapter: {health.ldapMode}</div>
              <div>SLA Sweep Interval: {health.slaSweepMinutes} min</div>
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5 text-xs space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Operator MFA (TOTP RFC 6238)
            </h3>
            <span className={`font-mono ${user.mfa_enabled ? 'text-emerald-700' : 'text-amber-700'}`}>
              {user.mfa_enabled ? 'ENABLED' : 'NOT CONFIGURED'}
            </span>
          </div>
          {!user.mfa_enabled && !mfaSetup && (
            <button
              onClick={startMfaEnroll}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-700 text-white rounded-md font-medium"
            >
              <Key className="w-3.5 h-3.5" /> Enroll TOTP Authenticator
            </button>
          )}
          {mfaSetup && (
            <form onSubmit={confirmMfa} className="space-y-2 border-t border-slate-200 pt-3">
              <div className="font-mono break-all bg-slate-50 p-2 rounded border border-slate-200">
                Secret: {mfaSetup.secret}
                {mfaSetup.currentSampleCode && (
                  <div className="text-blue-700 mt-1">Dev Test Code: {mfaSetup.currentSampleCode}</div>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  required
                  maxLength={6}
                  placeholder="Enter 6-digit TOTP code"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  className="flex-1 px-3 py-1.5 border border-slate-300 rounded-md font-mono"
                />
                <button type="submit" className="px-3 py-1.5 bg-emerald-700 text-white rounded-md">Verify</button>
              </div>
            </form>
          )}
          {user.mfa_enabled && (
            <button
              onClick={async () => {
                await apiRequest('/api/auth/mfa/disable', { method: 'POST' });
                setNotice('MFA disabled.');
                onRefreshUser();
              }}
              className="px-3 py-1.5 border border-red-300 text-red-700 rounded-md hover:bg-red-50"
            >
              Disable MFA
            </button>
          )}
        </div>
      </div>

      {/* Active Sessions & Token Revocation */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h3 className="font-display text-sm font-semibold text-slate-900 mb-3">
          Active & Recent Operator Sessions (Token Revocation Blocklist)
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-2 text-left">Session JTI</th>
                <th className="py-2 text-left">Operator</th>
                <th className="py-2 text-left">Auth Method</th>
                <th className="py-2 text-left">Expires</th>
                <th className="py-2 text-left">State</th>
                <th className="py-2 text-right">Revoke</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sessions.map((s) => (
                <tr key={s.jti}>
                  <td className="py-2 font-mono">{s.jti.slice(0, 12)}…</td>
                  <td className="py-2">{s.full_name} ({s.operator_role})</td>
                  <td className="py-2 font-mono">{s.auth_method}</td>
                  <td className="py-2 font-mono tabular-nums">{formatTimestamp(s.expires_at)}</td>
                  <td className={`py-2 ${s.revoked_at ? 'text-red-700' : 'text-emerald-700'}`}>
                    {s.revoked_at ? 'Revoked' : 'Active'}
                  </td>
                  <td className="py-2 text-right">
                    {!s.revoked_at && (
                      <button
                        onClick={() => revokeSession(s.jti)}
                        className="text-red-700 hover:underline font-medium"
                      >
                        Revoke Token
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Architecture Topology Diagram */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h3 className="font-display text-sm font-semibold text-slate-900 mb-3">
          Logical System Architecture (12 Integrated Components)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="border border-slate-200 rounded p-3 bg-slate-50">
            <div className="font-semibold text-slate-900 mb-1">Presentation & Auth Layer</div>
            <div className="text-slate-600 space-y-1">
              <div>A. IAM Operations Dashboard (React + Vite)</div>
              <div>J. Keycloak OIDC PKCE / Meridian IdP</div>
              <div>Security: 30m JWT + TOTP MFA + Lockout</div>
            </div>
          </div>
          <div className="border border-slate-200 rounded p-3 bg-slate-50">
            <div className="font-semibold text-slate-900 mb-1">Core Governance & Engines</div>
            <div className="text-slate-600 space-y-1">
              <div>B. Identity Management & JML Engine</div>
              <div>C. Access Request & Multi-Stage Approval</div>
              <div>D. Provisioning Orchestration Queue</div>
              <div>E. Catalog Admin & RBAC / SoD Engine</div>
            </div>
          </div>
          <div className="border border-slate-200 rounded p-3 bg-slate-50">
            <div className="font-semibold text-slate-900 mb-1">Ops, Compliance & Persistence</div>
            <div className="text-slate-600 space-y-1">
              <div>F. ITSM Ticketing · G. Access Certification</div>
              <div>H. Hash-Chained Audit · I. SLA Scheduler</div>
              <div>K. OpenLDAP Directory · L. Relational SQL DB</div>
            </div>
          </div>
        </div>
      </div>

      {/* Documentation Browser */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h3 className="font-display text-sm font-semibold text-slate-900 mb-3">
          Lab Documentation & Runbooks
        </h3>
        <div className="flex flex-wrap gap-2 mb-4">
          {docsList.map((doc) => (
            <button
              key={doc}
              onClick={() => openDoc(doc)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border rounded-md ${
                activeDoc?.file === doc
                  ? 'bg-blue-700 text-white border-blue-700'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              {doc}
            </button>
          ))}
        </div>
        {activeDoc && (
          <pre className="p-4 bg-slate-50 border border-slate-200 rounded-md text-xs font-mono whitespace-pre-wrap max-h-96 overflow-y-auto text-slate-800">
            {activeDoc.content}
          </pre>
        )}
      </div>
    </div>
  );
};

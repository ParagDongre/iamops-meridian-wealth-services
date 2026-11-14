import React, { useEffect, useState } from 'react';
import {
  Activity,
  Award,
  BarChart3,
  CheckSquare,
  GitBranch,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  ServerCog,
  Settings,
  ShieldAlert,
  Ticket,
  Users,
  X,
} from 'lucide-react';
import { AuditComplianceModule, SystemConfigModule } from './components/AuditAndSystem';
import { CatalogAndRbacModule } from './components/CatalogAndRbac';
import { IdentityDirectoryModule, JmlWorkflowModule } from './components/IdentityAndJml';
import { LoginScreen } from './components/LoginScreen';
import { ExecutiveOverview, SlaReportsModule } from './components/OverviewAndReports';
import { AccessRequestsModule, ProvisioningQueueModule } from './components/RequestsAndProvisioning';
import { AccessCertificationModule, TicketsAndIncidentsModule } from './components/TicketsAndCerts';
import { apiRequest, type AuthUser, type NavModule } from './types';

const NAV_ITEMS: Array<{ id: NavModule; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'overview', label: 'Executive Overview', icon: LayoutDashboard },
  { id: 'identities', label: 'Identity Directory', icon: Users },
  { id: 'jml', label: 'Joiner / Mover / Leaver', icon: GitBranch },
  { id: 'requests', label: 'Access Requests', icon: CheckSquare },
  { id: 'provisioning', label: 'Provisioning Queue', icon: ServerCog },
  { id: 'catalog', label: 'App & Catalog Admin', icon: Layers },
  { id: 'tickets', label: 'Tickets & Incidents', icon: Ticket },
  { id: 'certification', label: 'Access Certification', icon: Award },
  { id: 'audit', label: 'Audit & Compliance', icon: ShieldAlert },
  { id: 'sla', label: 'SLA & Reports', icon: BarChart3 },
  { id: 'system', label: 'System Configuration', icon: Settings },
];

export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('iamops_token'));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [activeModule, setActiveModule] = useState<NavModule>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const loadSession = async () => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    if (code && state) {
      try {
        const res = await apiRequest<{ token: string; user: AuthUser }>('/api/auth/oidc/callback', {
          method: 'POST',
          token: null,
          body: JSON.stringify({ code, state }),
        });
        localStorage.setItem('iamops_token', res.token);
        setToken(res.token);
        setUser(res.user);
        window.history.replaceState({}, document.title, window.location.pathname);
        setCheckingAuth(false);
        return;
      } catch {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }

    const stored = localStorage.getItem('iamops_token');
    if (!stored) {
      setUser(null);
      setCheckingAuth(false);
      return;
    }
    try {
      const res = await apiRequest<{ user: AuthUser }>('/api/auth/me', { token: stored });
      setUser(res.user);
      setToken(stored);
    } catch {
      localStorage.removeItem('iamops_token');
      setToken(null);
      setUser(null);
    } finally {
      setCheckingAuth(false);
    }
  };

  useEffect(() => {
    loadSession();
  }, []);

  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors during sign-out
    }
    localStorage.removeItem('iamops_token');
    setToken(null);
    setUser(null);
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-600">
        Verifying operator session...
      </div>
    );
  }

  if (!user || !token) {
    return (
      <LoginScreen
        onAuthenticated={(newToken, authUser) => {
          setToken(newToken);
          setUser(authUser);
          setActiveModule('overview');
        }}
      />
    );
  }

  const activeItem = NAV_ITEMS.find((n) => n.id === activeModule)!;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-slate-900 text-slate-100 border-r border-slate-800">
        <div className="h-14 px-5 flex items-center gap-2.5 border-b border-slate-800">
          <Activity className="w-5 h-5 text-blue-400 shrink-0" />
          <span className="font-display font-bold text-base tracking-tight text-white whitespace-nowrap">
            IAMOps Console
          </span>
        </div>
        <div className="px-5 py-3 border-b border-slate-800 text-xs text-slate-400">
          Meridian Wealth Services
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeModule === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveModule(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-blue-700 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-slate-900/50" onClick={() => setMobileNavOpen(false)} />
          <aside className="relative w-64 bg-slate-900 text-slate-100 h-full flex flex-col z-10">
            <div className="h-14 px-5 flex items-center justify-between border-b border-slate-800">
              <span className="font-display font-bold text-base text-white">IAMOps Console</span>
              <button onClick={() => setMobileNavOpen(false)} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeModule === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveModule(item.id);
                      setMobileNavOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-md ${
                      active ? 'bg-blue-700 text-white' : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Workspace */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract: Breadcrumb on left, profile + primary Sign Out on right */}
        <header className="h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-1.5 text-slate-600 hover:text-slate-900"
              aria-label="Open Navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-xs sm:text-sm text-slate-500 truncate">
              <span>Meridian Wealth Services</span>
              <span className="mx-2">/</span>
              <span className="font-semibold text-slate-900">{activeItem.label}</span>
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <div className="hidden sm:block text-right text-xs">
              <span className="font-medium text-slate-900">{user.full_name}</span>
              <span className="mx-1.5 text-slate-400">·</span>
              <span className="font-mono text-slate-600">{user.operator_role}</span>
              <span className="mx-1.5 text-slate-400">·</span>
              <span className="font-mono text-slate-500">{user.auth_method}</span>
            </div>
            <button
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {activeModule === 'overview' && <ExecutiveOverview onNavigate={setActiveModule} user={user} />}
          {activeModule === 'identities' && <IdentityDirectoryModule user={user} />}
          {activeModule === 'jml' && <JmlWorkflowModule user={user} />}
          {activeModule === 'requests' && <AccessRequestsModule user={user} />}
          {activeModule === 'provisioning' && <ProvisioningQueueModule user={user} />}
          {activeModule === 'catalog' && <CatalogAndRbacModule user={user} />}
          {activeModule === 'tickets' && <TicketsAndIncidentsModule user={user} />}
          {activeModule === 'certification' && <AccessCertificationModule user={user} />}
          {activeModule === 'audit' && <AuditComplianceModule />}
          {activeModule === 'sla' && <SlaReportsModule user={user} />}
          {activeModule === 'system' && (
            <SystemConfigModule user={user} onRefreshUser={loadSession} />
          )}
        </main>
      </div>
    </div>
  );
}

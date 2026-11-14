import React, { useEffect, useState } from 'react';
import { KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { apiRequest, type AuthUser } from '../types';

interface LoginScreenProps {
  onAuthenticated: (token: string, user: AuthUser) => void;
}

interface AuthConfigResponse {
  env: string;
  oidcMode: string;
  keycloakRealm: string;
  tokenTtlMinutes: number;
  lockoutThreshold: number;
  demoAccounts: Array<{ username: string; role: string; label: string }>;
}

const DEMO_PASSWORDS: Record<string, string> = {
  'iam.admin': 'MeridianAdmin!2026',
  'iam.analyst': 'MeridianAnalyst!2026',
  'wealth.manager': 'MeridianManager!2026',
  'app.owner': 'MeridianOwner!2026',
  'compliance.auditor': 'MeridianAuditor!2026',
};

export const LoginScreen: React.FC<LoginScreenProps> = ({ onAuthenticated }) => {
  const [authConfig, setAuthConfig] = useState<AuthConfigResponse | null>(null);
  const [username, setUsername] = useState('iam.admin');
  const [password, setPassword] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // OIDC PKCE Consent modal state (when using Meridian IdP OIDC flow)
  const [oidcModal, setOidcModal] = useState<{
    state: string;
    codeChallenge: string;
    realm: string;
    clientId: string;
  } | null>(null);
  const [oidcUser, setOidcUser] = useState('iam.admin');
  const [oidcPass, setOidcPass] = useState('');

  useEffect(() => {
    apiRequest<AuthConfigResponse>('/api/auth/config', { token: null })
      .then((cfg) => {
        setAuthConfig(cfg);
        if (cfg.env !== 'prod' && cfg.demoAccounts.length > 0) {
          setPassword(DEMO_PASSWORDS['iam.admin'] || '');
          setOidcPass(DEMO_PASSWORDS['iam.admin'] || '');
        }
      })
      .catch(() => {});
  }, []);

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<{
        mfaRequired?: boolean;
        token?: string;
        user?: AuthUser;
      }>('/api/auth/login', {
        method: 'POST',
        token: null,
        body: JSON.stringify({
          username,
          password,
          ...(mfaRequired ? { mfaCode } : {}),
        }),
      });
      if (res.mfaRequired) {
        setMfaRequired(true);
        setLoading(false);
        return;
      }
      if (res.token && res.user) {
        localStorage.setItem('iamops_token', res.token);
        onAuthenticated(res.token, res.user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  const handleStartOidc = async () => {
    setError(null);
    try {
      const res = await apiRequest<{
        mode: string;
        authorizeUrl?: string;
        state: string;
        codeChallenge: string;
        realm: string;
        clientId: string;
      }>(`/api/auth/oidc/authorize?redirect_uri=${encodeURIComponent(window.location.origin + '/')}`, {
        token: null,
      });

      if (res.mode === 'external_keycloak' && res.authorizeUrl) {
        window.location.assign(res.authorizeUrl);
        return;
      }
      setOidcModal({
        state: res.state,
        codeChallenge: res.codeChallenge,
        realm: res.realm,
        clientId: res.clientId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to initiate OIDC SSO');
    }
  };

  const handleCompleteOidcConsent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oidcModal) return;
    setError(null);
    setLoading(true);
    try {
      const consent = await apiRequest<{ code: string; state: string }>('/api/auth/oidc/consent', {
        method: 'POST',
        token: null,
        body: JSON.stringify({
          state: oidcModal.state,
          username: oidcUser,
          password: oidcPass,
          codeChallenge: oidcModal.codeChallenge,
        }),
      });
      const cb = await apiRequest<{ token: string; user: AuthUser }>('/api/auth/oidc/callback', {
        method: 'POST',
        token: null,
        body: JSON.stringify({ code: consent.code, state: consent.state }),
      });
      localStorage.setItem('iamops_token', cb.token);
      onAuthenticated(cb.token, cb.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OIDC SSO failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex items-center justify-center gap-2.5 text-slate-900">
          <ShieldCheck className="w-7 h-7 text-blue-700" />
          <span className="font-display text-2xl font-bold tracking-tight">
            Meridian Wealth Services
          </span>
        </div>
        <h1 className="mt-3 text-center font-display text-lg font-semibold text-slate-700">
          IAMOps Operations & Governance Console
        </h1>
        <p className="mt-1 text-center text-xs text-slate-500">
          30-minute revocable sessions · 5-attempt lockout protection · OIDC PKCE & TOTP MFA
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-7 px-6 border border-slate-200 rounded-lg sm:px-8">
          {error && (
            <div className="mb-5 p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-800">
              {error}
            </div>
          )}

          <form onSubmit={handlePasswordLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Operator Username or Email
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
              />
            </div>

            {mfaRequired && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  6-Digit Authenticator TOTP Code
                </label>
                <input
                  type="text"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  placeholder="000000"
                  required
                  className="w-full px-3 py-2 text-sm font-mono tracking-widest border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
            >
              <Lock className="w-4 h-4" />
              {loading ? 'Authenticating...' : mfaRequired ? 'Verify MFA & Sign In' : 'Sign In with Password'}
            </button>
          </form>

          <div className="mt-5 pt-5 border-t border-slate-200">
            <button
              type="button"
              onClick={handleStartOidc}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium rounded-md transition-colors"
            >
              <KeyRound className="w-4 h-4" />
              Sign In with Keycloak / Meridian SSO (OIDC PKCE)
            </button>
          </div>

          {authConfig && authConfig.demoAccounts.length > 0 && (
            <div className="mt-6 pt-5 border-t border-slate-200">
              <p className="text-xs font-medium text-slate-600 mb-2">
                Lab Operator Quick-Fill ({authConfig.env} mode only):
              </p>
              <div className="grid grid-cols-1 gap-1.5">
                {authConfig.demoAccounts.map((acc) => (
                  <button
                    key={acc.username}
                    type="button"
                    onClick={() => {
                      setUsername(acc.username);
                      setPassword(DEMO_PASSWORDS[acc.username] || '');
                      setOidcUser(acc.username);
                      setOidcPass(DEMO_PASSWORDS[acc.username] || '');
                      setMfaRequired(false);
                      setError(null);
                    }}
                    className="flex items-center justify-between px-3 py-1.5 text-left text-xs border border-slate-200 rounded hover:bg-slate-50 transition-colors"
                  >
                    <span className="font-medium text-slate-800">{acc.label}</span>
                    <span className="font-mono text-slate-500">{acc.role}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {oidcModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-md w-full p-6">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Meridian IdP — OIDC Authorization Consent
            </h2>
            <p className="mt-1 text-xs text-slate-500 font-mono">
              Realm: {oidcModal.realm} · Client: {oidcModal.clientId} · PKCE S256
            </p>
            <form onSubmit={handleCompleteOidcConsent} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">SSO Username</label>
                <input
                  type="text"
                  value={oidcUser}
                  onChange={(e) => setOidcUser(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">SSO Password</label>
                <input
                  type="password"
                  value={oidcPass}
                  onChange={(e) => setOidcPass(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOidcModal(null)}
                  className="px-3 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md"
                >
                  Authorize & Exchange Token
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

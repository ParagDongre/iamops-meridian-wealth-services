export type OperatorRole = 'iam_admin' | 'iam_analyst' | 'manager' | 'auditor' | 'app_owner';

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  full_name: string;
  operator_role: OperatorRole;
  auth_method: 'password' | 'oidc_sso';
  mfa_enabled?: boolean;
}

export type NavModule =
  | 'overview'
  | 'identities'
  | 'jml'
  | 'requests'
  | 'provisioning'
  | 'catalog'
  | 'tickets'
  | 'certification'
  | 'audit'
  | 'sla'
  | 'system';

export async function apiRequest<T = any>(
  path: string,
  options: RequestInit & { token?: string | null } = {}
): Promise<T> {
  const { token, headers, ...rest } = options;
  const authToken = token !== undefined ? token : localStorage.getItem('iamops_token');

  const res = await fetch(path, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(headers || {}),
    },
  });

  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    if (contentType.includes('application/json')) {
      const errBody = await res.json().catch(() => ({}));
      message = errBody.error || message;
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  if (contentType.includes('application/json')) {
    return res.json() as Promise<T>;
  }
  return res.text() as unknown as T;
}

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export function statusTextClass(status: string): string {
  const s = status.toLowerCase();
  if (
    ['active', 'fulfilled', 'approved', 'certified', 'resolved', 'closed', 'success', 'nominal'].includes(s)
  ) {
    return 'text-emerald-700 font-medium';
  }
  if (['pending approval', 'pending', 'queued', 'in progress', 'provisioning', 'investigate', 'warning', 'open'].includes(s)) {
    return 'text-amber-700 font-medium';
  }
  if (['failed', 'rejected', 'disabled', 'terminated', 'revoked', 'blocked', 'escalated', 'inappropriate', 'critical', 'failure'].includes(s)) {
    return 'text-red-700 font-medium';
  }
  return 'text-slate-700 font-medium';
}

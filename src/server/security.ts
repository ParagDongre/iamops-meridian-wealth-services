import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { AppConfig } from './config.js';
import type { DB } from './db.js';

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  full_name: string;
  operator_role: 'iam_admin' | 'iam_analyst' | 'manager' | 'auditor' | 'app_owner';
  auth_method: 'password' | 'oidc_sso';
  jti: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      requestId?: string;
    }
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, keyHex] = stored.split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derived, storedBuf);
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64');
}

export function signJwt(
  payload: Omit<AuthUser, 'jti'> & { jti?: string },
  secret: string,
  expiresMinutes = 30
): { token: string; jti: string; expiresAt: string } {
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + expiresMinutes * 60;
  const jti = payload.jti || crypto.randomUUID();
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(
    JSON.stringify({
      ...payload,
      jti,
      iat: nowSec,
      exp: expSec,
    })
  );
  const sig = base64UrlEncode(
    crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest()
  );
  return {
    token: `${header}.${body}.${sig}`,
    jti,
    expiresAt: new Date(expSec * 1000).toISOString(),
  };
}

export function verifyJwt(token: string, secret: string): (AuthUser & { exp: number }) | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expectedSig = base64UrlEncode(
    crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest()
  );
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(base64UrlDecode(body).toString('utf8'));
    if (!parsed.exp || Math.floor(Date.now() / 1000) >= parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// RFC 6238 Base32 TOTP (30-second window)
const BASE32_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(): string {
  const bytes = crypto.randomBytes(20);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    out += BASE32_ALPHA[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  }
  return out;
}

function base32ToBuffer(secret: string): Buffer {
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const ch of clean) {
    const idx = BASE32_ALPHA.indexOf(ch);
    if (idx >= 0) bits += idx.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function generateTotpCode(secret: string, stepOffset = 0): string {
  const key = base32ToBuffer(secret);
  const counter = Math.floor(Date.now() / 1000 / 30) + stepOffset;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

export function verifyTotpCode(secret: string, code: string): boolean {
  const normalized = code.trim();
  if (!/^\d{6}$/.test(normalized)) return false;
  for (const offset of [-1, 0, 1]) {
    if (generateTotpCode(secret, offset) === normalized) return true;
  }
  return false;
}

// Per-IP sliding window login rate limiter (15 attempts / 60s)
export class IpRateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private maxHits = 15,
    private windowMs = 60_000
  ) {}

  check(ip: string): { allowed: boolean; retryAfterSec: number } {
    const now = Date.now();
    const arr = (this.hits.get(ip) || []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.maxHits) {
      const oldest = arr[0];
      return { allowed: false, retryAfterSec: Math.ceil((this.windowMs - (now - oldest)) / 1000) };
    }
    arr.push(now);
    this.hits.set(ip, arr);
    return { allowed: true, retryAfterSec: 0 };
  }

  reset() {
    this.hits.clear();
  }
}

export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

export function requestLoggerMiddleware(env: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const reqId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
    req.requestId = reqId;
    res.setHeader('X-Request-Id', reqId);
    const start = Date.now();
    res.on('finish', () => {
      if (env !== 'test' && req.path.startsWith('/api')) {
        console.log(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
            request_id: reqId,
            method: req.method,
            path: req.path,
            status: res.statusCode,
            duration_ms: Date.now() - start,
            actor: req.user?.username || 'anonymous',
          })
        );
      }
    });
    next();
  };
}

export function createAuthMiddleware(db: DB, config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
      res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
      return;
    }
    const decoded = verifyJwt(token, config.jwtSecret);
    if (!decoded) {
      res.status(401).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
      return;
    }
    const revoked = db
      .prepare('SELECT jti FROM revoked_tokens WHERE jti = ?')
      .get(decoded.jti) as { jti: string } | undefined;
    if (revoked) {
      res.status(401).json({ error: 'Token has been revoked', code: 'TOKEN_REVOKED' });
      return;
    }
    const op = db
      .prepare('SELECT id, is_active, operator_role, full_name, email, username FROM operator_accounts WHERE id = ?')
      .get(decoded.id) as
      | {
          id: string;
          is_active: number;
          operator_role: AuthUser['operator_role'];
          full_name: string;
          email: string;
          username: string;
        }
      | undefined;
    if (!op || !op.is_active) {
      res.status(403).json({ error: 'Operator account disabled', code: 'ACCOUNT_DISABLED' });
      return;
    }
    req.user = {
      id: op.id,
      username: op.username,
      email: op.email,
      full_name: op.full_name,
      operator_role: op.operator_role,
      auth_method: decoded.auth_method,
      jti: decoded.jti,
    };
    next();
  };
}

export function requireRole(...allowedRoles: AuthUser['operator_role'][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!allowedRoles.includes(req.user.operator_role)) {
      res.status(403).json({
        error: `Forbidden: requires role [${allowedRoles.join(', ')}], current role is ${req.user.operator_role}`,
        code: 'FORBIDDEN_ROLE',
      });
      return;
    }
    next();
  };
}

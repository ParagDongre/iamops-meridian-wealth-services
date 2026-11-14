import path from 'node:path';

export interface AppConfig {
  env: 'dev' | 'prod' | 'test';
  port: number;
  appUrl: string;
  jwtSecret: string;
  mfaEncryptionKey: string;
  databasePath: string;
  slaSweepMinutes: number;
  disableApiDocs: boolean;
  keycloakUrl: string;
  keycloakRealm: string;
  keycloakClientId: string;
  keycloakClientSecret: string;
  keycloakAdminUser: string;
  keycloakAdminPassword: string;
  ldapUrl: string;
  ldapBaseDn: string;
}

const UNSAFE_SECRETS = new Set([
  '',
  'changeme',
  'secret',
  'dev-secret',
  'dev-iamops-local-jwt-secret-change-in-prod',
  'dev-iamops-mfa-encryption-key-change-in-prod',
  'MY_JWT_SECRET',
  'placeholder',
]);

export function loadConfig(): AppConfig {
  const rawEnv = (process.env.ENV || process.env.NODE_ENV || 'dev').toLowerCase();
  const env: 'dev' | 'prod' | 'test' =
    rawEnv === 'production' || rawEnv === 'prod'
      ? 'prod'
      : rawEnv === 'test'
        ? 'test'
        : 'dev';

  const jwtSecret =
    process.env.JWT_SECRET ||
    (env === 'prod' ? '' : 'dev-iamops-local-jwt-secret-change-in-prod');
  const mfaEncryptionKey =
    process.env.MFA_ENCRYPTION_KEY ||
    (env === 'prod' ? '' : 'dev-iamops-mfa-encryption-key-change-in-prod');

  const databasePath =
    process.env.DATABASE_PATH ||
    (env === 'test' ? ':memory:' : path.resolve(process.cwd(), 'data', 'iamops.db'));

  if (env === 'prod') {
    if (!jwtSecret || jwtSecret.length < 32 || UNSAFE_SECRETS.has(jwtSecret)) {
      throw new Error(
        'SAFE STARTUP BLOCKED: In ENV=prod, JWT_SECRET must be set to a unique random secret >= 32 characters.'
      );
    }
    if (!mfaEncryptionKey || mfaEncryptionKey.length < 32 || UNSAFE_SECRETS.has(mfaEncryptionKey)) {
      throw new Error(
        'SAFE STARTUP BLOCKED: In ENV=prod, MFA_ENCRYPTION_KEY must be set to a unique random secret >= 32 characters.'
      );
    }
    if (databasePath === ':memory:') {
      throw new Error('SAFE STARTUP BLOCKED: In ENV=prod, DATABASE_PATH cannot be :memory:.');
    }
  }

  return {
    env,
    port: Number(process.env.PORT || 3000),
    appUrl: process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`,
    jwtSecret,
    mfaEncryptionKey,
    databasePath,
    slaSweepMinutes: Number(process.env.SLA_SWEEP_MINUTES ?? 5),
    disableApiDocs:
      process.env.DISABLE_API_DOCS === 'true' || (env === 'prod' && process.env.DISABLE_API_DOCS !== 'false'),
    keycloakUrl: (process.env.KEYCLOAK_URL || '').replace(/\/$/, ''),
    keycloakRealm: process.env.KEYCLOAK_REALM || 'meridian',
    keycloakClientId: process.env.KEYCLOAK_CLIENT_ID || 'iamops-console',
    keycloakClientSecret: process.env.KEYCLOAK_CLIENT_SECRET || '',
    keycloakAdminUser: process.env.KEYCLOAK_ADMIN_USER || '',
    keycloakAdminPassword: process.env.KEYCLOAK_ADMIN_PASSWORD || '',
    ldapUrl: process.env.LDAP_URL || '',
    ldapBaseDn: process.env.LDAP_BASE_DN || 'dc=meridian,dc=internal',
  };
}

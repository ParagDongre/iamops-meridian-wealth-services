# Production Deployment Guide

## 1. Environment Variables
Create a `.env` file alongside `docker-compose.prod.yml` with strong random secrets (`openssl rand -hex 32`):
```bash
APP_URL=https://iamops.example.com
IAMOPS_DOMAIN=iamops.example.com
JWT_SECRET=<32+ char random secret>
MFA_ENCRYPTION_KEY=<32+ char random secret>
BOOTSTRAP_ADMIN_PASSWORD=<strong admin password>
KC_DB_PASSWORD=<strong postgres password>
KEYCLOAK_ADMIN_PASSWORD=<strong keycloak admin password>
LDAP_ADMIN_PASSWORD=<strong ldap admin password>
```

## 2. Start the Hardened Stack
```bash
docker compose -f docker-compose.prod.yml up -d --build
```
- Only Caddy ports `80` and `443` are published externally; Keycloak, Postgres, OpenLDAP, and the IAMOps API remain on the internal Docker network.
- On first startup in `ENV=prod`, IAMOps creates only the `iam.admin` operator account with zero demo data.
- Sign in as `iam.admin`, open **App & Catalog Admin**, and either create your custom apps/roles/SoD policies or click **Load Meridian Baseline Catalog**.

## 3. Health Checks
- Liveness: `GET /health/live`
- Readiness: `GET /health/ready`

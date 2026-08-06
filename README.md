# Nexus Science API

Backend Fastify + Drizzle + PostgreSQL para a consultoria Nexus Science.

## Stack

- Node.js 20 + TypeScript + Fastify
- Drizzle ORM + PostgreSQL
- JWT (cookies HttpOnly) + RBAC
- Docker Compose (KVM1 Hostinger)

## Desenvolvimento

```bash
cp .env.example .env
# Suba um Postgres local (Docker) e ajuste DATABASE_URL
npm install
npm run db:push
npm run db:seed
npm run dev
```

## Deploy

Ver [DEPLOY.md](./DEPLOY.md) — CI/CD via GitHub Actions → SSH na KVM1.

## Segurança

Ver [deploy/SECURITY.md](./deploy/SECURITY.md).

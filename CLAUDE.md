# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See also `../CLAUDE.md` for workspace-level context (this is one of two repos in a local workspace folder).

## Stack

Fastify 5 + TypeScript (ESM, Node >=20) + Drizzle ORM (PostgreSQL) + Zod 4 for validation. Auth via `@fastify/jwt` with access/refresh tokens in HttpOnly/Secure/SameSite=Strict cookies.

## Commands

- `npm run dev` — tsx watch dev server
- `npm run build` — `tsc` to `dist/`
- `npm run db:generate` / `db:migrate` / `db:push` / `db:studio` — Drizzle Kit
- `npm run db:seed` — seeds DB, including the default admin user
- `npm run lint` / `lint:fix` / `format` / `format:check` — Biome (lint+format in one tool). CI runs `tsc --noEmit` then `npm run lint` then a Docker build.

## Linting — Biome, not ESLint

`typescript-eslint` doesn't support this project's TypeScript version yet (hard runtime guard, not just a peer-dep warning — see `typescript-eslint/typescript-eslint#10940`). Biome is used instead since it ships its own TS parser and doesn't depend on the `typescript` package at all. Config is `biome.json`. A Husky pre-commit hook runs `biome check --write` on staged files (auto-fixes, doesn't block on fixable issues).

## Testing — no automated suite

There is no Jest/Vitest/etc. Verification bar is: `tsc --noEmit` passes, plus (for behavioral changes) manually running the QA scripts in `scripts/qa-*.ts` against a live server:

```
npx tsx scripts/qa-api.ts          # general API QA
npx tsx scripts/qa-rbac.ts         # RBAC/permission checks
npx tsx scripts/qa-training-patch.ts
```

These hit a running instance over HTTP (`API_URL` env var, defaults to `http://localhost:3333`) and assert response codes/cookies — the API and Postgres must actually be running first. The `qa-api` skill (`/qa-api`) automates this.

## Environment variables

Required and validated at boot via Zod (`src/lib/env.ts`) — the process exits with a logged field error if invalid:

- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — **must be ≥64 characters** (e.g. `openssl rand -base64 64`)
- `FIELD_ENCRYPTION_KEY` — **must be exactly 64 hex chars** (32 bytes, AES-256-GCM; `openssl rand -hex 32`)
- `CORS_ORIGIN` — comma-separated allowlist, never `*`
- `DATABASE_URL`, `COOKIE_DOMAIN`, `COOKIE_SECURE`, `ASAAS_API_KEY`/`ASAAS_WEBHOOK_TOKEN`/`ASAAS_BASE_URL`, `AI_PROVIDER` (`openai`|`gemini`) + matching API key, `SEED_ADMIN_*`

Two separate compose/env pairs exist — don't conflate them:
- root `../docker-compose.yml` + `../.env` — local dev, Postgres only
- `docker-compose.yml` + `.env.docker` — full KVM1 production stack (postgres+api+nginx, memory-capped)

## Auth / RBAC

Roles: `ADMIN`, `TRAINER`, `FINANCE`, `RECEPTION`, `STUDENT`. Trainers are restricted to only their assigned students (IDOR prevention is already implemented — preserve this when touching student-scoped routes). Login is rate-limited to 5 attempts/15min per IP, on top of a global 200 req/min limit (`@fastify/rate-limit`, configured in `src/app.ts`).

## Deploy

Push to `main` (or manual dispatch) triggers `.github/workflows/deploy.yml`: SSHes into KVM1 and runs `git fetch origin main && git reset --hard origin/main && docker compose --env-file .env.docker up -d --build --remove-orphans`, then health-checks `/health`. This means **the KVM1 checkout must never have local hand-edits** — they get wiped on next deploy. The `deploy-api` skill (`/deploy-api`) walks this runbook; full details in `DEPLOY.md`.

## Known accepted risk

`npm audit` flags a moderate `esbuild`/`@esbuild-kit` vulnerability via `drizzle-kit` (dev dependency only). There's no real fix upstream — `drizzle-kit` still pulls this transitively as of its latest release, and `npm audit fix --force` would downgrade it 13+ minor versions to one predating its current config format. It's dev-tooling-only exposure (production image uses `npm ci --omit=dev`, confirmed in `Dockerfile`) — left as-is rather than risk breaking the migration workflow for a low-severity, non-production issue.

## Git workflow

Currently committing directly to `main`. Once moved to a service-account setup, this becomes feature branches merged to `main` via service-account-approved PRs — check current practice if unsure which phase you're in.

#!/usr/bin/env bash
# Rodado na KVM1 depois de git reset --hard origin/main.
# Envs já foram gravadas pelo Actions a partir dos secrets do GitHub.
set -euo pipefail
cd /opt/nexus-science-api

COMPOSE=(docker compose --env-file .env.docker)

echo "==> Build api + migrate"
"${COMPOSE[@]}" --profile ops build

echo "==> Postgres"
"${COMPOSE[@]}" up -d postgres
for i in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T postgres pg_isready >/dev/null 2>&1; then
    echo "Postgres ready"
    break
  fi
  if [ "$i" = 30 ]; then
    echo "Postgres did not become ready"
    "${COMPOSE[@]}" logs postgres --tail 40
    exit 1
  fi
  sleep 2
done

echo "==> Schema (drizzle-kit push)"
"${COMPOSE[@]}" --profile ops run --rm migrate

echo "==> API"
"${COMPOSE[@]}" up -d --remove-orphans
docker image prune -f

for i in $(seq 1 30); do
  status=$(docker inspect --format '{{.State.Health.Status}}' nexus-api 2>/dev/null || echo starting)
  if [ "$status" = "healthy" ]; then
    echo "API healthy"
    break
  fi
  if [ "$i" = 30 ]; then
    echo "API did not become healthy (status: $status)"
    docker logs nexus-api --tail 80
    exit 1
  fi
  sleep 3
done

echo "Deploy OK"

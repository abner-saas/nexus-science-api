#!/usr/bin/env bash
# Setup inicial na KVM1 (rode uma vez como usuário de deploy)
set -euo pipefail

APP_DIR="${1:-/opt/nexus-science-api}"
REPO_URL="${2:?informe a URL do repo, ex: git@github.com:USER/nexus-science-api.git}"

sudo mkdir -p "$APP_DIR"
sudo chown "$USER:$USER" "$APP_DIR"

if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Edite $APP_DIR/.env com secrets de produção"
fi

if [ ! -f .env.docker ]; then
  cp .env.docker.example .env.docker
  echo "Edite $APP_DIR/.env.docker com a senha do Postgres"
fi

echo "Próximos passos:"
echo "  1. Preencha .env e .env.docker"
echo "  2. docker compose --env-file .env.docker up -d --build"
echo "  3. docker compose exec api npx drizzle-kit push  (ou npm run db:push local com tunnel)"
echo "  4. Configure UFW: 80, 443 e SSH custom"
echo "  5. Adicione secrets no GitHub Actions (ver DEPLOY.md)"

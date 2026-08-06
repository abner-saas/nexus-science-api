# Deploy — Nexus Science API (KVM1 Hostinger)

## Arquitetura

```
GitHub (main) → GitHub Actions (SSH) → KVM1
                                      ├── nginx :80/:443
                                      ├── api (Fastify)
                                      └── postgres (rede interna)
```

Frontend na Vercel aponta `NEXT_PUBLIC_API_URL` para o domínio da API (ex.: `https://api.seudominio.com`).

## 1. Setup único na KVM1

```bash
# Na VPS
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git curl
sudo usermod -aG docker $USER
# relogue

# Chave SSH dedicada ao deploy (no seu PC)
ssh-keygen -t ed25519 -C "github-deploy-nexus" -f ~/.ssh/nexus_deploy -N ""
# Copie a pública para a VPS:
ssh-copy-id -i ~/.ssh/nexus_deploy.pub USUARIO@IP_DA_KVM

# Clone (use a URL HTTPS ou SSH do repo)
bash deploy/setup-kvm1.sh /opt/nexus-science-api git@github.com:SEU_USER/nexus-science-api.git
```

Edite na VPS:

- `/opt/nexus-science-api/.env` — JWT, CORS (`https://seu-app.vercel.app`), Asaas, etc.
- `/opt/nexus-science-api/.env.docker` — senha do Postgres

Suba pela primeira vez:

```bash
cd /opt/nexus-science-api
docker compose --env-file .env.docker up -d --build
```

## 2. Secrets no GitHub (`Settings → Secrets and variables → Actions`)

| Secret | Exemplo |
|--------|---------|
| `KVM_HOST` | `203.0.113.10` |
| `KVM_USER` | `deploy` |
| `KVM_SSH_KEY` | conteúdo completo da chave **privada** `nexus_deploy` |
| `KVM_PORT` | `22` (ou porta SSH custom) |
| `KVM_DEPLOY_PATH` | `/opt/nexus-science-api` |

Crie também o Environment `production` (opcional, mas recomendado) em **Settings → Environments**.

## 3. Fluxo automático

Todo push em `main`:

1. Workflow `CI` — typecheck + build Docker  
2. Workflow `Deploy KVM1` — SSH → `git reset --hard` → `docker compose up -d --build`

## 4. Domínio / SSL

Com Nginx + Certbot (recomendado):

```bash
sudo apt install certbot
# Ajuste server_name no nginx e monte certificados em deploy/nginx/certs
# ou use um proxy Hostinger / Cloudflare na frente
```

## 5. Firewall (UFW)

```bash
sudo ufw default deny incoming
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow SEU_SSH_PORT/tcp
sudo ufw enable
```

**Nunca** exponha a porta 5432 do Postgres na internet.

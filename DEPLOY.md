# Deploy — Nexus Science API (KVM1 Hostinger)

## Arquitetura

```
GitHub (main) → GitHub Actions (Tailscale, tag:ci) → KVM1 (tag:prod-api)
                                      ├── Caddy (compartilhado, fora deste compose) :80/:443
                                      │     └── reverse_proxy → nexus-api:3333
                                      ├── nexus-api (Fastify, container "nexus-api")
                                      ├── migrate (one-shot, drizzle-kit push)
                                      └── postgres (rede interna, sem porta publicada)
```

O GitHub Actions **não conecta via SSH público**. O runner entra na tailnet como um node efêmero com a tag `tag:ci` (autenticado por um OAuth client escopado só a `auth_keys: write`) e faz o deploy via Tailscale SSH — sem precisar abrir nenhuma porta na VPS pro GitHub. Isso contornou o firewall do hPanel da Hostinger, que bloqueava conexões SSH vindas das faixas de IP do GitHub Actions (a porta 22 pública continua exatamente como estava antes, sem nenhuma mudança).

A política de acesso da tailnet (Access controls) autoriza especificamente `tag:ci → tag:prod-api` via SSH como root, e nada além disso — ver `"ssh"` no policy file da tailnet.

**Esta VPS é compartilhada com outro projeto** (não relacionado ao Nexus Science) que já roda um Caddy próprio, dono das portas 80/443 da máquina. Por isso o `docker-compose.yml` deste repo **não** sobe nginx/Caddy — o serviço `api` apenas entra numa rede Docker externa (`upi-avatar-napsi-backend_default`, já criada pelo outro projeto) pra ficar alcançável pelo Caddy compartilhado. Isso é uma particularidade **desta VPS específica**, não um padrão geral do projeto — se um dia o Nexus Science migrar pra uma VPS dedicada, o certo é voltar a ter um Caddy/nginx próprio no compose.

O bloco correspondente já foi adicionado manualmente no Caddyfile compartilhado (`/root/UPi-Avatar-NAPSI-backend/Caddyfile` na VPS):

```
api-abner-saas.patitow.dev {
	reverse_proxy nexus-api:3333
}
```

Frontend na Vercel aponta `NEXT_PUBLIC_API_URL` para `https://api-abner-saas.patitow.dev`. Como front (Vercel) e API (patitow.dev) estão em domínios raiz diferentes, os cookies de autenticação são cross-site — `COOKIE_SAME_SITE=none` (+ `COOKIE_SECURE=true`) é obrigatório no `.env` da API para o login funcionar; veja `.env.example`.

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

Edite **só no GitHub** (Environment `production`): secrets `APP_ENV` e `DOCKER_ENV` — o deploy grava `/opt/nexus-science-api/.env` e `.env.docker`. Não edite esses arquivos na VPS; o próximo push sobrescreve.

Suba pela primeira vez (depois dos secrets no GitHub): `gh workflow run deploy.yml` neste repo, ou um push em `main`.

## 2. Secrets no GitHub (fonte da verdade)

Environment **`production`** → **Settings → Environments → production → Environment secrets**.

| Secret | Uso |
|--------|-----|
| `TS_OAUTH_CLIENT_ID` | OAuth client da Tailscale — escopo `auth_keys: write`, tag `tag:ci`. |
| `TS_OAUTH_CLIENT_SECRET` | Secret desse OAuth client. |
| `APP_ENV` | Conteúdo inteiro do `.env` da API (JWT, CORS, Google, Asaas, OpenAI…). Mesmo formato do `.env.example`. |
| `DOCKER_ENV` | Conteúdo inteiro do `.env.docker` (`POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`). |

O job de deploy **falha antes de mexer na VPS** se `APP_ENV`/`DOCKER_ENV` estiverem vazios ou sem chaves obrigatórias (`scripts/check-prod-env.py`).

Não commitar esses arquivos. O workflow copia o blob para a VPS (`chmod 600`) a cada deploy — a VPS só recebe.

`KVM_HOST` / `KVM_USER` / `KVM_SSH_KEY` / `KVM_PORT` são legado do SSH público — não usados pelo `deploy.yml`.

Pra criar o OAuth client da Tailscale: **Settings → Trust credentials → New credential → OAuth**, escopo **Auth Keys: Write**, tag `tag:ci`. A tag precisa existir em `tagOwners` na política da tailnet antes.

### Bootstrap (uma vez)

1. Pegue o `.env` e o `.env.docker` **atuais** da VPS (não cole no chat).
2. Ajuste o `.env`: `BETTER_AUTH_URL=https://api-abner-saas.patitow.dev`, `COOKIE_SECURE=true`, `COOKIE_SAME_SITE=none`, `CORS_ORIGIN=https://nexus-science-web.vercel.app`, Google client/secret, `BETTER_AUTH_SECRET`.
3. Cole cada arquivo em `APP_ENV` e `DOCKER_ENV` no Environment `production`.
4. Só então dê push em `main` (ou `workflow_dispatch`).

Trocar um valor depois: edita o secret no GitHub e roda o workflow de novo. Não SSH pra “dar um jeito” no `.env`.

## 3. Fluxo automático

Todo push em `main` (e `workflow_dispatch`):

1. Workflow `CI` — typecheck + build das imagens `runner` e `migrate`
2. Workflow `Deploy KVM1` — valida `APP_ENV`/`DOCKER_ENV` → Tailscale → grava `.env` na VPS → `git reset --hard origin/main` → `scripts/deploy-remote.sh`:
   - sobe Postgres
   - `drizzle-kit push --force` (schema, inclusive `ba_*`)
   - rebuild/recreate da API
   - espera `healthy`

`drizzle-kit push` aplica o diff do schema. `--force` auto-aprova statements que possam truncar — não delete coluna em `schema.ts` no mesmo deploy em que ainda precisa dos dados. Migrations versionadas (`drizzle-kit generate`) são o próximo passo se o time crescer.

## Acesso manual / emergência

A chave SSH dedicada (`nexus_deploy`) e o IP público (`KVM_HOST`) continuam funcionando pra acesso direto, fora do pipeline — útil se a Tailscale tiver algum problema pontual. `ssh -i ~/.ssh/nexus_deploy root@<KVM_HOST>`.

## 4. Domínio / SSL

Nesta VPS, o certificado é responsabilidade do **Caddy compartilhado** (outro projeto), que já faz HTTPS automático via Let's Encrypt/Cloudflare para os domínios que ele serve — o bloco do `api-abner-saas.patitow.dev` foi adicionado ao Caddyfile dele (ver seção "Arquitetura" acima). Não há nginx nem certbot próprios do Nexus Science nesta VPS.

DNS: registro `A` de `api-abner-saas.patitow.dev` para o IP da VPS, **proxied** no Cloudflare (mesmo padrão dos outros domínios já apontados pra essa máquina — proxy desligado só é usado nos domínios que apontam pra Vercel).

## 5. Firewall (UFW)

**Ainda não configurado nesta VPS** (nenhum UFW instalado até o momento deste deploy) — a máquina está exposta só pelo firewall de borda da hospedagem, se houver. Como a VPS é compartilhada com outro projeto que já usa as portas 80/443/22, qualquer regra de UFW precisa considerar os dois:

```bash
sudo apt install -y ufw
sudo ufw default deny incoming
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 22/tcp   # ou a porta SSH customizada, se houver
sudo ufw enable
```

**Nunca** exponha a porta 5432 do Postgres na internet — o `docker-compose.yml` deste repo já usa `expose` (rede interna) em vez de `ports`, então o Postgres do Nexus Science nunca fica acessível de fora mesmo sem UFW. (O Postgres do *outro* projeto nesta VPS, porém, está publicado em `0.0.0.0:5432` — fora do escopo deste repo, mas vale corrigir lá também.)

## 6. Google OAuth em produção

Front: `https://nexus-science-web.vercel.app`. API: `https://api-abner-saas.patitow.dev`.

O deploy já aplica schema (`ba_*`, `password_hash` nullable) e já copia o `.env` do GitHub. O que **não** é env:

### Google Cloud Console (uma vez)

**Origens JavaScript autorizadas**

- `http://localhost:3000`
- `http://localhost:3333`
- `https://nexus-science-web.vercel.app`
- `https://api-abner-saas.patitow.dev`

**URIs de redirecionamento autorizados** (letra por letra)

- `http://localhost:3333/api/auth/callback/google`
- `https://api-abner-saas.patitow.dev/api/auth/callback/google`

O callback é a **API**, não a Vercel. Preview `*.vercel.app` de PR não entra — o Console não aceita wildcard.

### Dentro do `APP_ENV` (GitHub)

```env
CORS_ORIGIN=https://nexus-science-web.vercel.app
COOKIE_SECURE=true
COOKIE_SAME_SITE=none
BETTER_AUTH_URL=https://api-abner-saas.patitow.dev
BETTER_AUTH_SECRET=<openssl rand -base64 32>
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Vercel **não** leva `GOOGLE_CLIENT_*`. Só `NEXT_PUBLIC_API_URL=https://api-abner-saas.patitow.dev`.

Confirmação pós-deploy: `GET https://api-abner-saas.patitow.dev/auth/providers` → `{"data":{"google":true}}`.

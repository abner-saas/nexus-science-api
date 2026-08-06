# Segurança — Nexus Science (OWASP)

Checklist alinhado ao prompt de hardening e OWASP Top 10.

## Backend

- [x] Validação Zod em todos os inputs
- [x] Drizzle ORM (queries parametrizadas; evitar `sql.raw`)
- [x] JWT em cookies `HttpOnly` + `Secure` + `SameSite=Strict`
- [x] Rate limit global + 5 login / 15 min por IP
- [x] Helmet (CSP em produção)
- [x] CORS estrito (`CORS_ORIGIN`, nunca `*`)
- [x] RBAC por papel (`ADMIN`, `TRAINER`, `FINANCE`, `RECEPTION`, `STUDENT`)
- [x] Prevenção IDOR (treinador só vê alunos atribuídos)
- [x] bcrypt 12 rounds
- [x] Campos sensíveis (restrições/lesões) criptografados AES-256-GCM
- [x] Webhook Asaas autenticado por token compartilhado
- [x] Containers sem privilégios elevados (`no-new-privileges`, user não-root)

## Hostinger KVM1

```bash
# UFW — só 80/443 + SSH custom
ufw default deny incoming
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow <SSH_PORT>/tcp
ufw enable

# Nginx: server_tokens off (já no deploy/nginx/nginx.conf)
```

## OWASP ZAP

1. Rode **Baseline / Spider** em staging (nunca Active Scan agressivo na KVM1 de produção).
2. Confirme headers: CSP, X-Content-Type-Options, sem `server` version leak.
3. Teste troca de IDs em `/students/:id` (IDOR).
4. Teste force brute em `/auth/login` (deve retornar 429).

## LGPD

- Dados de saúde/restrições: criptografia em repouso
- Fotos de avaliação: apenas URLs de object storage (nunca Base64 no Postgres)
- Audit log para ações sensíveis (tabela `audit_logs`)

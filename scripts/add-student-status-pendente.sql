-- Adiciona 'Pendente' ao enum student_status (lead com checkout, ainda sem pagar).
-- Idempotente no Postgres 15+ (IF NOT EXISTS). Rode só no Postgres local de QA.
-- Não aplicar na VPS de produção por este script — o próximo deploy usa drizzle-kit push.
--
-- ADD VALUE não pode rodar dentro de uma transação no Postgres < 12. Este arquivo
-- é uma sentença solta, sem BEGIN/COMMIT.

ALTER TYPE student_status ADD VALUE IF NOT EXISTS 'Pendente';

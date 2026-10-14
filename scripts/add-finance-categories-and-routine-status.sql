-- Categorias financeiras e status de rotina usados pelo painel.
-- Rotinas antigas "Ativa" passam a ser a rotina em andamento do aluno.

CREATE TABLE IF NOT EXISTS finance_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(80) NOT NULL,
  type transaction_type NOT NULL,
  match_terms text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_categories_name_type_uidx
  ON finance_categories (name, type);

INSERT INTO finance_categories (name, type, match_terms)
VALUES
  ('Mensalidades', 'RECEITA', 'mensalidade, plano, asaas'),
  ('Internet', 'DESPESA', 'internet, fibra, claro net, vivo fibra'),
  ('Energia', 'DESPESA', 'energia, enel, neoenergia, celpe, light'),
  ('Aluguel', 'DESPESA', 'aluguel'),
  ('Marketing', 'DESPESA', 'marketing, meta ads, google ads, anuncio'),
  ('Ferramentas', 'DESPESA', 'software, ferramenta, assinatura'),
  ('Operacional', 'DESPESA', 'operacional')
ON CONFLICT (name, type) DO NOTHING;

UPDATE training_routines
SET status = 'Em andamento'
WHERE status = 'Ativa';

ALTER TABLE training_routines
  ALTER COLUMN status SET DEFAULT 'Em digitação';

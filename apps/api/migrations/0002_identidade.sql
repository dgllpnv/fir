-- ---------------------------------------------------------------------------
-- Identidade: perfis de acesso, pessoas, sessões.
--
-- O PIN de 4 dígitos da v20 NÃO existe aqui. Login é por e-mail e senha, por
-- pessoa, com Argon2id — decisão D-3 em docs/decisoes.md.
-- ---------------------------------------------------------------------------

CREATE TABLE perfis (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES clinicas(id),
  chave      text NOT NULL,                  -- 'pf_rec', 'pf_enf', …
  nome       text NOT NULL,
  perms      text[] NOT NULL DEFAULT '{}',
  criado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinica_id, chave)
);

CREATE TABLE pessoas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id    uuid NOT NULL REFERENCES clinicas(id),
  nome          text NOT NULL,
  email         text NOT NULL,
  funcao        text NOT NULL DEFAULT '',
  senha_hash    text NOT NULL,
  admin         boolean NOT NULL DEFAULT false,
  perfil_id     uuid REFERENCES perfis(id),
  -- Estado, nunca exclusão: o histórico de quem fez o quê não pode sumir
  -- porque alguém saiu da clínica.
  ativo         boolean NOT NULL DEFAULT true,
  criada_em     timestamptz NOT NULL DEFAULT now(),
  -- O e-mail é único POR CLÍNICA: a mesma pessoa pode atender duas clínicas.
  UNIQUE (clinica_id, email)
);

-- Administrador não tem perfil; quem não é administrador precisa de um.
ALTER TABLE pessoas ADD CONSTRAINT pessoa_tem_acesso_definido
  CHECK ((admin AND perfil_id IS NULL) OR (NOT admin AND perfil_id IS NOT NULL));

CREATE TABLE sessoes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id  uuid NOT NULL REFERENCES clinicas(id),
  pessoa_id   uuid NOT NULL REFERENCES pessoas(id),
  -- O token nunca é guardado em claro: um dump do banco não vale por um login.
  token_hash  text NOT NULL UNIQUE,
  criada_em   timestamptz NOT NULL DEFAULT now(),
  expira_em   timestamptz NOT NULL,
  revogada_em timestamptz
);
CREATE INDEX sessoes_pessoa ON sessoes (pessoa_id) WHERE revogada_em IS NULL;

-- Limite de tentativas: dez mil combinações sem limite foi o maior risco da
-- v20. O identificador é hasheado com pepper para que a tabela não vire uma
-- lista de e-mails de clientes.
CREATE TABLE tentativas_login (
  id             bigserial PRIMARY KEY,
  clinica_id     uuid NOT NULL REFERENCES clinicas(id),
  identificador  text NOT NULL,
  em             timestamptz NOT NULL DEFAULT now(),
  sucesso        boolean NOT NULL
);
CREATE INDEX tentativas_recentes ON tentativas_login (clinica_id, identificador, em DESC);

-- ---------------------------------------------------------------------------
-- RLS em tudo. FORCE para que nem o dono da tabela escape.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['perfis', 'pessoas', 'sessoes', 'tentativas_login'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I_por_clinica ON %I USING (clinica_id = app_clinica_id()) '
      'WITH CHECK (clinica_id = app_clinica_id())', t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO fir_app', t);
  END LOOP;
END $$;

GRANT USAGE, SELECT ON SEQUENCE tentativas_login_id_seq TO fir_app;

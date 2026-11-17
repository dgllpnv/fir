-- Acesso por e-mail e redefinição de senha (ADR 2026-11-16, spec acesso-por-email,
-- gates acesso-por-email-gate-appsec.md e acesso-por-email-gate-lgpd.md).
--
-- O e-mail volta como SEGUNDO identificador: o usuário continua existindo e
-- funcionando.
--
-- DOIS campos, e a separação é condição do gate (appsec 2):
--   `email`          o CONFIRMADO. É o único que autentica, que recebe link de
--                    redefinição e que ocupa o índice único da clínica.
--   `email_pendente` o digitado e ainda não provado (pela admin no convite, ou
--                    pela própria pessoa). Não é único: um pendente não pode
--                    bloquear o e-mail de uma colega nem revelar quem usa qual.
-- O confirmado continua valendo até o pendente ser confirmado (LGPD L8).
SELECT set_config('app.pessoa_id', 'sistema', true);

ALTER TABLE pessoas ADD COLUMN email text;
ALTER TABLE pessoas ADD COLUMN email_confirmado_em timestamptz;
ALTER TABLE pessoas ADD COLUMN email_pendente text;
ALTER TABLE pessoas ADD COLUMN aguardando_primeira_senha boolean NOT NULL DEFAULT false;

-- A forma canônica é do BANCO: a mesma regra de `canonizarEmail`/`validarEmail`
-- do domínio, comparadas em teste/identidade-com-email.test.ts.
ALTER TABLE pessoas ADD CONSTRAINT email_canonico CHECK (
  email IS NULL OR (email = lower(btrim(email)) AND length(email) <= 254
                    AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'));
ALTER TABLE pessoas ADD CONSTRAINT email_pendente_canonico CHECK (
  email_pendente IS NULL OR (email_pendente = lower(btrim(email_pendente)) AND length(email_pendente) <= 254
                             AND email_pendente ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'));
ALTER TABLE pessoas ADD CONSTRAINT email_confirmado_tem_data
  CHECK ((email IS NULL) = (email_confirmado_em IS NULL));

-- Único POR CLÍNICA entre quem não foi excluído (LGPD L9 apaga o da excluída).
CREATE UNIQUE INDEX pessoas_email_por_clinica
  ON pessoas (clinica_id, email)
  WHERE email IS NOT NULL AND excluida_em IS NULL;

CREATE TABLE links_de_acesso (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id     uuid NOT NULL REFERENCES clinicas(id),
  pessoa_id      uuid NOT NULL,
  finalidade     text NOT NULL CHECK (finalidade IN ('convite', 'redefinicao', 'confirmacao_de_email')),
  -- O HMAC do endereço PARA ONDE o link foi, e nunca o endereço (LGPD L4). É o
  -- que prende o link ao e-mail (appsec 3): se o e-mail da pessoa mudou depois
  -- do envio, o HMAC não casa e o link não vale.
  email_hmac     text NOT NULL CHECK (email_hmac ~ '^[0-9a-f]{64}$'),
  token_hash     text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  criado_em      timestamptz NOT NULL DEFAULT now(),
  expira_em      timestamptz NOT NULL,
  usado_em       timestamptz,
  invalidado_em  timestamptz,
  CONSTRAINT link_expira_depois CHECK (expira_em > criado_em),
  CONSTRAINT link_usado_ou_invalidado CHECK (usado_em IS NULL OR invalidado_em IS NULL),
  CONSTRAINT link_da_pessoa_da_clinica FOREIGN KEY (pessoa_id, clinica_id)
    REFERENCES pessoas (id, clinica_id)
);
-- UM link vivo por pessoa e finalidade, no BANCO (appsec 6): dois pedidos de
-- esqueci-senha simultâneos não produzem dois links válidos. "Vivo" aqui é não
-- usado e não invalidado; o vencido continua ocupando a vaga até o próximo
-- link invalidá-lo na mesma transação que o cria.
CREATE UNIQUE INDEX links_de_acesso_um_vivo
  ON links_de_acesso (clinica_id, pessoa_id, finalidade)
  WHERE usado_em IS NULL AND invalidado_em IS NULL;
COMMENT ON TABLE links_de_acesso IS
  'Links de uso único (convite, redefinição, confirmação de e-mail). Só hashes. '
  'Retenção: 30 dias depois do último de expira_em/usado_em/invalidado_em (LGPD L5).';

-- Eventos para Atividades. SEM trigger de auditoria (LGPD L6): copiar o evento
-- para a `auditoria` o faria herdar os 5 anos dela. Retenção própria: 1 ano.
CREATE TABLE eventos_de_acesso (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id  uuid NOT NULL REFERENCES clinicas(id),
  pessoa_id   uuid,
  evento      text NOT NULL CHECK (evento IN (
                'convite_enviado', 'convite_reenviado', 'redefinicao_enviada_pela_admin',
                'pedido_de_redefinicao', 'pedido_sem_conta',
                'senha_criada_pelo_convite', 'senha_redefinida_pelo_link',
                'email_cadastrado', 'email_confirmado',
                'link_vencido', 'link_ja_usado')),
  -- Quem fez, quando provou quem é (a admin que reenviou); NULL quando foi o
  -- sistema ou alguém sem sessão.
  por_pessoa_id uuid,
  em          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evento_da_pessoa_da_clinica FOREIGN KEY (pessoa_id, clinica_id)
    REFERENCES pessoas (id, clinica_id),
  CONSTRAINT evento_por_pessoa_da_clinica FOREIGN KEY (por_pessoa_id, clinica_id)
    REFERENCES pessoas (id, clinica_id),
  -- Pedido para e-mail sem conta não tem pessoa, e NÃO guarda o e-mail
  -- digitado (é de um terceiro). Todo outro evento é de uma pessoa.
  CONSTRAINT evento_tem_pessoa CHECK ((evento = 'pedido_sem_conta') = (pessoa_id IS NULL))
);
CREATE INDEX eventos_de_acesso_por_clinica ON eventos_de_acesso (clinica_id, em DESC);
COMMENT ON TABLE eventos_de_acesso IS
  'Eventos do acesso por e-mail para Atividades (backlog 3.2). Sem e-mail, IP, user agent ou token. '
  'Retenção: 1 ano (LGPD L6).';

ALTER TABLE links_de_acesso ENABLE ROW LEVEL SECURITY;
ALTER TABLE links_de_acesso FORCE ROW LEVEL SECURITY;
CREATE POLICY links_de_acesso_por_clinica ON links_de_acesso
  USING (clinica_id = app_clinica_id()) WITH CHECK (clinica_id = app_clinica_id());
CREATE TRIGGER links_de_acesso_auditoria AFTER INSERT OR UPDATE OR DELETE ON links_de_acesso
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

ALTER TABLE eventos_de_acesso ENABLE ROW LEVEL SECURITY;
ALTER TABLE eventos_de_acesso FORCE ROW LEVEL SECURITY;
CREATE POLICY eventos_de_acesso_por_clinica ON eventos_de_acesso
  USING (clinica_id = app_clinica_id()) WITH CHECK (clinica_id = app_clinica_id());

-- Link: nasce e é usado ou invalidado; nada mais muda nele (appsec 18).
--
-- O REVOKE de UPDATE na TABELA vem antes do GRANT por coluna, e é ele que faz o
-- trabalho: o `ALTER DEFAULT PRIVILEGES` do bootstrap concede os quatro verbos a
-- `fir_app` em toda tabela nova, e um GRANT por coluna em cima de um UPDATE de
-- tabela não estreita nada — `UPDATE … SET token_hash` passaria. Medido na
-- primeira aplicação desta migration, que só tinha o GRANT.
REVOKE UPDATE, DELETE, TRUNCATE ON links_de_acesso FROM fir_app;
GRANT SELECT, INSERT ON links_de_acesso TO fir_app;
GRANT UPDATE (usado_em, invalidado_em) ON links_de_acesso TO fir_app;
-- Evento: só nasce.
REVOKE UPDATE, DELETE, TRUNCATE ON eventos_de_acesso FROM fir_app;
GRANT SELECT, INSERT ON eventos_de_acesso TO fir_app;
-- O painel lê Atividades da clínica, e INVALIDA links quando desativa, exclui
-- ou define provisória (appsec 7): a escrita de pessoa é a mesma nos dois pools.
GRANT SELECT ON eventos_de_acesso TO fir_painel;
GRANT SELECT ON links_de_acesso TO fir_painel;
GRANT UPDATE (invalidado_em) ON links_de_acesso TO fir_painel;

-- O HMAC do link entra na denylist da trilha junto com o token (LGPD L4).
CREATE OR REPLACE FUNCTION auditoria_sem_segredos(p jsonb) RETURNS jsonb
  LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog
  AS $$
    SELECT CASE WHEN p IS NULL THEN NULL ELSE coalesce(
      (SELECT jsonb_object_agg(
                k,
                CASE WHEN k = ANY (ARRAY['senha_hash', 'token_hash', 'url_secreta',
                                         'segredo_cifrado', 'hash', 'impressao_da_chave',
                                         'referencia_cifrada', 'email_hmac',
                                         -- O pendente ainda não foi provado: pode
                                         -- ser o endereço de um terceiro digitado
                                         -- errado, e a trilha guarda 5 anos.
                                         'email_pendente'])
                     THEN '"[oculto]"'::jsonb
                     ELSE p -> k END)
         FROM jsonb_object_keys(p) k),
      p) END
  $$;

-- ---------------------------------------------------------------------------
-- O ovo e a galinha do `resolver_sessao`, de novo: a rota pública que recebe o
-- token não sabe a clínica, e a RLS exige a clínica que esta consulta existe
-- para descobrir. Molde exato da 0022 (appsec 17): `search_path` fixo, REVOKE
-- de PUBLIC, recusa de entrada que não seja hash de 64 hex, só resolve —
-- nunca grava.
-- ---------------------------------------------------------------------------
CREATE FUNCTION resolver_link_de_acesso(p_token_hash text)
  RETURNS TABLE (
    id uuid, clinica_id uuid, pessoa_id uuid, finalidade text, email_hmac text,
    expira_em timestamptz, usado_em timestamptz, invalidado_em timestamptz
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT l.id, l.clinica_id, l.pessoa_id, l.finalidade, l.email_hmac,
           l.expira_em, l.usado_em, l.invalidado_em
      FROM public.links_de_acesso l
      -- Clínica inativa não aceita link (appsec 7), como `contextoDoToken`
      -- derruba a sessão de clínica desativada.
      JOIN public.clinicas c ON c.id = l.clinica_id AND c.ativa
     WHERE p_token_hash ~ '^[0-9a-f]{64}$'
       AND l.token_hash = p_token_hash
  $$;

COMMENT ON FUNCTION resolver_link_de_acesso(text) IS
  'Traduz o hash de um link de acesso em (clínica, pessoa, finalidade). SECURITY DEFINER pela '
  'mesma razão de resolver_sessao. Não enumera: exige os 256 bits do token. Só lê.';

REVOKE ALL ON FUNCTION resolver_link_de_acesso(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolver_link_de_acesso(text) TO fir_app;

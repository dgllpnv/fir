-- ---------------------------------------------------------------------------
-- SEGUNDO FATOR (TOTP) DO `Usuário de Gestão` — gate appsec G8, A-12.
-- D-22 item 13: revoga a emenda de 2026-11-05 da ADR 0012 e fecha a dívida
-- D3b. ADR 0022.
--
-- Só EXPANDE: tabelas novas, uma coluna anulável, uma coluna com padrão.
-- Nada existente muda de significado.
--
-- `usuarios_gestao` NÃO GANHA COLUNA NEM GRANT (F-1/A-1, 0041): a identidade
-- continua escrita só pelo painel, e `fir_carteira` continua gravando ali só
-- as três colunas de senha. O estado do TOTP mora numa tabela própria, uma
-- linha por usuário. Ela não concede acesso a nada — não há coluna nela que
-- eleve o que uma sessão alcança —, então escrevê-la pelo papel da sessão não
-- reabre o F-1.
--
-- Por que não RLS nela: o estado é escrito no LOGIN (o anti-replay avança
-- `ultimo_passo` antes de existir sessão, ator `sistema`), a mesma situação de
-- `sessoes_de_carteira`/`tentativas_de_carteira`, que também não têm RLS.
-- Uma policy que precisa liberar `sistema` não separaria ninguém.
-- ---------------------------------------------------------------------------

-- 1. O estado do TOTP. Linha ausente = nunca cadastrou (ou foi resetado).
--
-- `ativado_em IS NULL` com segredo presente = cadastro PENDENTE (o primeiro
-- código ainda não chegou). O segredo é ciphertext AES-256-GCM
-- (IV ‖ tag ‖ corpo, AAD = usuario_gestao:<id>:v<versão>); a chave mora em
-- `FIR_CHAVE_SEGUNDO_FATOR_CARTEIRA`, fora do banco. `ultimo_passo` é o
-- anti-replay: passo ≤ a ele é recusado, mesmo dentro da janela.
CREATE TABLE segundo_fator_da_carteira (
  usuario_gestao_id    uuid PRIMARY KEY REFERENCES usuarios_gestao(id),
  segredo_cifrado      bytea,
  chave_versao         smallint,
  cadastro_iniciado_em timestamptz,
  ativado_em           timestamptz,
  ultimo_passo         bigint,
  -- Um código de recuperação foi usado: a próxima entrada mostra o aviso.
  recuperacao_usada_aviso_em timestamptz,
  CONSTRAINT segundo_fator_da_carteira_coerente CHECK (
    (segredo_cifrado IS NULL) = (chave_versao IS NULL)
    AND (ativado_em IS NULL OR segredo_cifrado IS NOT NULL)
  )
);

COMMENT ON COLUMN segundo_fator_da_carteira.segredo_cifrado IS
  'Segredo TOTP cifrado (AES-256-GCM, AAD = usuario_gestao:<id>:v<versao>). '
  'A chave nunca está no banco. Nunca em log, nunca em resposta depois da confirmação.';

-- 2. A sessão registra QUANDO o segundo fator foi provado nela. `NULL` = uma
-- sessão que só passou pela senha (usuário ainda sem TOTP): o guard a deixa
-- alcançar só o cadastro, `eu` e `sair`.
ALTER TABLE sessoes_de_carteira ADD COLUMN segundo_fator_em timestamptz;

-- 3. O tipo da tentativa. O limite da SENHA conta `senha`; o do segundo fator
-- conta `totp` e `recuperacao` juntos, POR CONTA (identificador
-- `usuario_gestao:<id>`), atravessando desafios.
ALTER TABLE tentativas_de_carteira
  ADD COLUMN tipo text NOT NULL DEFAULT 'senha'
    CHECK (tipo IN ('senha', 'totp', 'recuperacao'));

-- 4. O DESAFIO: o que a senha certa entrega a quem tem TOTP. Não é sessão —
-- nenhuma rota de carteira o aceita. Opaco (só o hash fica aqui), 5 min,
-- morre com 5 erros ou no primeiro acerto.
CREATE TABLE desafios_de_carteira (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_gestao_id uuid NOT NULL REFERENCES usuarios_gestao(id),
  token_hash        text NOT NULL UNIQUE,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  expira_em         timestamptz NOT NULL,
  erros             smallint NOT NULL DEFAULT 0 CHECK (erros >= 0),
  concluido_em      timestamptz,
  revogado_em       timestamptz
);
CREATE INDEX desafios_de_carteira_vivos ON desafios_de_carteira (usuario_gestao_id)
  WHERE concluido_em IS NULL AND revogado_em IS NULL;

-- 5. Os códigos de recuperação — só o HMAC (pepper fora do banco). Uso único:
-- `usado_em`. Gerar de novo ou o reset do Operador marcam `invalidado_em`.
-- Sem DELETE: a linha usada é a prova de QUANDO o código foi usado.
CREATE TABLE codigos_de_recuperacao_da_carteira (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_gestao_id uuid NOT NULL REFERENCES usuarios_gestao(id),
  hash              text NOT NULL UNIQUE,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  usado_em          timestamptz,
  invalidado_em     timestamptz
);
CREATE INDEX codigos_de_recuperacao_da_carteira_vivos
  ON codigos_de_recuperacao_da_carteira (usuario_gestao_id)
  WHERE usado_em IS NULL AND invalidado_em IS NULL;

-- 6. O segredo e o hash entram na denylist da trilha (0004/0037): se um dia
-- uma trigger de auditoria cobrir estas tabelas, ela registra QUE mudou,
-- nunca o valor.
CREATE OR REPLACE FUNCTION auditoria_sem_segredos(p jsonb) RETURNS jsonb
  LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog
  AS $$
    SELECT CASE WHEN p IS NULL THEN NULL ELSE coalesce(
      (SELECT jsonb_object_agg(
                k,
                CASE WHEN k = ANY (ARRAY['senha_hash', 'token_hash', 'url_secreta',
                                         'segredo_cifrado', 'hash'])
                     THEN '"[oculto]"'::jsonb
                     ELSE p -> k END)
         FROM jsonb_object_keys(p) k),
      p) END
  $$;

-- 7. PRIVILÉGIOS. Uma linha por GRANT, nunca `ALTER DEFAULT PRIVILEGES`.
REVOKE ALL ON segundo_fator_da_carteira, desafios_de_carteira, codigos_de_recuperacao_da_carteira FROM fir_app;

-- A sessão do próprio usuário: cadastra, confirma, avança o anti-replay.
GRANT SELECT, INSERT, UPDATE ON segundo_fator_da_carteira TO fir_carteira;
GRANT SELECT, INSERT, UPDATE ON desafios_de_carteira TO fir_carteira;
GRANT SELECT, INSERT ON codigos_de_recuperacao_da_carteira TO fir_carteira;
GRANT UPDATE (usado_em, invalidado_em) ON codigos_de_recuperacao_da_carteira TO fir_carteira;

-- O reset do Operador: apagar o estado (UPDATE para NULL) e marcar o fim de
-- sessões, desafios e códigos. Nunca criar nem apagar linha.
GRANT SELECT ON segundo_fator_da_carteira, desafios_de_carteira,
                codigos_de_recuperacao_da_carteira, sessoes_de_carteira TO fir_painel;
GRANT UPDATE ON segundo_fator_da_carteira TO fir_painel;
GRANT UPDATE (revogado_em) ON desafios_de_carteira TO fir_painel;
GRANT UPDATE (invalidado_em) ON codigos_de_recuperacao_da_carteira TO fir_painel;
GRANT UPDATE (revogada_em) ON sessoes_de_carteira TO fir_painel;

-- GUARDA: conferido, não presumido (mesma razão da 0041).
DO $$
BEGIN
  IF has_table_privilege('fir_carteira', 'usuarios_gestao', 'UPDATE')
     OR EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'usuarios_gestao'
          AND column_name NOT IN ('senha_hash', 'senha_provisoria', 'senha_provisoria_expira_em')
          AND has_column_privilege('fir_carteira', 'public.usuarios_gestao', column_name, 'UPDATE'))
  THEN
    RAISE EXCEPTION 'fir_carteira escreve em usuarios_gestao além das três colunas de senha'
      USING HINT = 'G8 F-1/A-1: a identidade só é escrita pelo painel.';
  END IF;
  IF NOT has_table_privilege('fir_carteira', 'segundo_fator_da_carteira', 'UPDATE') THEN
    RAISE EXCEPTION 'fir_carteira não recebeu o estado do TOTP';
  END IF;
  IF has_table_privilege('fir_carteira', 'segundo_fator_da_carteira', 'DELETE')
     OR has_table_privilege('fir_carteira', 'codigos_de_recuperacao_da_carteira', 'DELETE')
     OR has_table_privilege('fir_painel', 'segundo_fator_da_carteira', 'DELETE')
     OR has_table_privilege('fir_painel', 'codigos_de_recuperacao_da_carteira', 'DELETE')
     OR has_table_privilege('fir_painel', 'sessoes_de_carteira', 'INSERT') THEN
    RAISE EXCEPTION 'privilégio a mais nas tabelas do segundo fator';
  END IF;
END $$;

-- ===========================================================================
-- AS INTEGRAÇÕES DA CLÍNICA — o cofre da chave do MedX (spec
-- `docs/specs/integracao-medx.md`, seção A; ticket T1).
--
-- Uma linha por clínica. Quem escreve é o Operador (`fir_painel`); quem abre o
-- segredo é só o worker (`fir_integracoes`); a API do balcão (`fir_app`) lê o
-- estado para o bloco "Agenda ligada ao MedX" e NUNCA o segredo.
--
-- O segredo é SELADO na API com a chave pública e aberto no worker com a
-- privada (`src/integracoes/cofre-de-integracoes.ts`, gate S-2). Mesmo assim o
-- GRANT é por coluna: defesa em profundidade, e o ciphertext não atravessa
-- nem para o painel.
-- ===========================================================================
SELECT set_config('app.pessoa_id', 'sistema', true);

-- O papel nasce fora de migration (`fir_migrate` não tem CREATEROLE): local em
-- `infra/bootstrap-papeis.sql`, produção em `provisionar-integracoes.sh`.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fir_integracoes') THEN
    RAISE EXCEPTION 'o papel fir_integracoes não existe'
      USING HINT = 'Local: crie-o como em infra/bootstrap-papeis.sql. Produção: bash provisionar-integracoes.sh.';
  END IF;
  IF (SELECT rolbypassrls OR rolsuper OR rolcreaterole FROM pg_roles WHERE rolname = 'fir_integracoes') THEN
    RAISE EXCEPTION 'fir_integracoes tem BYPASSRLS, SUPERUSER ou CREATEROLE'
      USING HINT = 'Ele lê conteúdo da internet: nunca atravessa a RLS.';
  END IF;
END $$;

CREATE TABLE integracoes_da_clinica (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id            uuid NOT NULL REFERENCES clinicas(id) UNIQUE,
  provedor              text NOT NULL CHECK (provedor IN ('medx')),

  -- O SEGREDO. `segredo_cifrado` já está na denylist da trilha (0055).
  segredo_cifrado       bytea,
  segredo_versao        smallint,
  final_da_chave        text CHECK (final_da_chave ~ '^.{1,4}$'),
  -- HMAC hex com pepper fora do banco: a mesma chave em duas clínicas é
  -- recusada pela UNIQUE abaixo, sem que o banco guarde o que a revele (S-6).
  impressao_da_chave    text CHECK (impressao_da_chave ~ '^[0-9a-f]{64}$'),
  CONSTRAINT segredo_inteiro CHECK (
    (segredo_cifrado IS NULL) = (segredo_versao IS NULL)
    AND (segredo_cifrado IS NULL) = (final_da_chave IS NULL)
    AND (segredo_cifrado IS NULL) = (impressao_da_chave IS NULL)),

  -- O termo da clínica (LGPD B1): sem ele, nada liga.
  termo_assinado_em     date,
  termo_assinado_por    text CHECK (length(termo_assinado_por) BETWEEN 1 AND 200),
  termo_versao          text CHECK (length(termo_versao) BETWEEN 1 AND 50),
  CONSTRAINT termo_inteiro CHECK (
    (termo_assinado_em IS NULL) = (termo_assinado_por IS NULL)
    AND (termo_assinado_em IS NULL) = (termo_versao IS NULL)),

  -- O resultado do "Testar conexão", gravado pelo worker (T2).
  verificacao           text NOT NULL DEFAULT 'sem_chave'
                        CHECK (verificacao IN ('sem_chave', 'nao_verificada', 'ok', 'recusada')),
  -- "Pedida" não é estado: é `verificacao_pedida_em` mais recente que `verificada_em`.
  -- Assim pedir um teste novo não desliga uma integração que está funcionando.
  verificacao_pedida_em timestamptz,
  verificada_em         timestamptz,
  usuario_externo_nome  text CHECK (length(usuario_externo_nome) <= 200),
  conta_externa_id      text CHECK (length(conta_externa_id) BETWEEN 1 AND 100),
  escopos               text[] NOT NULL DEFAULT '{}',
  unidades_externas     integer NOT NULL DEFAULT 0 CHECK (unidades_externas >= 0),
  -- Mensagem do CATÁLOGO fixo (gate S-8), nunca texto do MedX.
  ultimo_erro           text NOT NULL DEFAULT '' CHECK (length(ultimo_erro) <= 300),

  agenda_ligada         boolean NOT NULL DEFAULT false,
  faturamento_ligado    boolean NOT NULL DEFAULT false,
  meta_medida_por       text NOT NULL DEFAULT 'fir' CHECK (meta_medida_por IN ('fir', 'medx')),
  status_de_cancelado   smallint[] NOT NULL DEFAULT '{}',

  criada_em             timestamptz NOT NULL DEFAULT now(),
  atualizada_em         timestamptz NOT NULL DEFAULT now(),

  -- Ligar exige termo e verificação verde com a conta do MedX (A.0, A.5).
  CONSTRAINT ligar_exige_termo_e_verificacao CHECK (
    NOT (agenda_ligada OR faturamento_ligado)
    OR (termo_assinado_em IS NOT NULL AND verificacao = 'ok' AND conta_externa_id IS NOT NULL))
);

COMMENT ON TABLE integracoes_da_clinica IS
  'A integração da clínica com o sistema dela (MedX). O segredo é selado; só fir_integracoes o lê.';

-- UNICIDADE GLOBAL (S-6): constraint não passa pela RLS, então a recusa vale
-- entre clínicas sem que ninguém leia a linha da outra.
CREATE UNIQUE INDEX integracao_chave_unica
  ON integracoes_da_clinica (provedor, impressao_da_chave) WHERE impressao_da_chave IS NOT NULL;
CREATE UNIQUE INDEX integracao_conta_unica
  ON integracoes_da_clinica (provedor, conta_externa_id) WHERE conta_externa_id IS NOT NULL;

ALTER TABLE integracoes_da_clinica ENABLE ROW LEVEL SECURITY;
ALTER TABLE integracoes_da_clinica FORCE  ROW LEVEL SECURITY;
CREATE POLICY integracoes_da_clinica_por_clinica ON integracoes_da_clinica
  USING (clinica_id = app_clinica_id()) WITH CHECK (clinica_id = app_clinica_id());
CREATE TRIGGER integracoes_da_clinica_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON integracoes_da_clinica
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

-- A impressão entra na denylist (o segredo já está desde a 0055).
CREATE OR REPLACE FUNCTION auditoria_sem_segredos(p jsonb) RETURNS jsonb
  LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog
  AS $$
    SELECT CASE WHEN p IS NULL THEN NULL ELSE coalesce(
      (SELECT jsonb_object_agg(
                k,
                CASE WHEN k = ANY (ARRAY['senha_hash', 'token_hash', 'url_secreta',
                                         'segredo_cifrado', 'hash', 'impressao_da_chave'])
                     THEN '"[oculto]"'::jsonb
                     ELSE p -> k END)
         FROM jsonb_object_keys(p) k),
      p) END
  $$;

-- PRIVILÉGIOS: uma linha por decisão.
REVOKE ALL ON integracoes_da_clinica FROM fir_app;

-- O balcão lê só o ESTADO (bloco D da spec). Nada de segredo, impressão,
-- conta, escopos, usuário do MedX nem termo.
GRANT SELECT (id, clinica_id, provedor, verificacao, ultimo_erro, agenda_ligada,
              faturamento_ligado, meta_medida_por, status_de_cancelado, atualizada_em)
  ON integracoes_da_clinica TO fir_app;

-- O Operador escreve tudo e lê tudo MENOS o segredo. Sem DELETE: remover a
-- chave é pôr NULL (A.7); a linha fica, com a trilha.
GRANT SELECT (id, clinica_id, provedor, segredo_versao, final_da_chave, impressao_da_chave,
              termo_assinado_em, termo_assinado_por, termo_versao, verificacao,
              verificacao_pedida_em, verificada_em, usuario_externo_nome, conta_externa_id,
              escopos, unidades_externas, ultimo_erro, agenda_ligada, faturamento_ligado,
              meta_medida_por, status_de_cancelado, criada_em, atualizada_em)
  ON integracoes_da_clinica TO fir_painel;
GRANT INSERT, UPDATE ON integracoes_da_clinica TO fir_painel;

-- O worker abre o segredo e grava SÓ o resultado da verificação e o erro.
GRANT SELECT ON integracoes_da_clinica TO fir_integracoes;
GRANT UPDATE (verificacao, verificada_em, usuario_externo_nome, conta_externa_id, escopos,
              unidades_externas, ultimo_erro, agenda_ligada, faturamento_ligado, atualizada_em)
  ON integracoes_da_clinica TO fir_integracoes;
-- A trilha não precisa de GRANT: `registrar_auditoria` é SECURITY DEFINER.
-- `app_clinica_id()` e companhia.
GRANT USAGE ON SCHEMA public TO fir_integracoes;

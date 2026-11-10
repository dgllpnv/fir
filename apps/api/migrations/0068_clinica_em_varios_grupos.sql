-- ===========================================================================
-- CLÍNICA EM VÁRIOS GRUPOS; O GRUPO FIRMARE CONTÉM TODAS.
-- Spec: docs/specs/clinica-em-varios-grupos.md (gate de 10/11/2026: appsec,
-- LGPD e números, todos "com ressalvas"). Substitui, na ADR 0011, "uma
-- clínica, um grupo" — ver a ADR 2026-11-10-clinica-em-varios-grupos.
--
-- Forward-only. Nenhuma linha existente muda de grupo; nenhum grupo perde
-- visão. O que muda:
--  1. `participacao_clinica_grupo`: a FONTE de "a clínica está no grupo".
--  2. Um Cliente Firmare por (grupo, clínica), e UM deles "conta na receita"
--     por clínica (`conta_na_receita`): só esse entra em MRR e cobrança.
--  3. O gatilho de vínculos da 0047 passa a exigir participação ativa e
--     proíbe mudar o grupo ou a clínica de um cliente (só o encerramento,
--     que o leva ao grupo `arquivo`, invisível a todo escopo `grupo`).
--  4. O gatilho da clínica nova (0067) cria também a participação.
--  5. `preencher_grupo_firmare(operador)`: o backfill, SEPARADO da migration
--     de propósito — só roda depois que o dono confirmar o DPA das clínicas.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- O operador da sessão. Sem parâmetro de ator: vem só de `app.pessoa_id`
-- (regex ANTES do cast; nunca exceção de cast), conferido em `operadores`.
-- ---------------------------------------------------------------------------
CREATE FUNCTION operador_da_sessao() RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_ator text := coalesce(current_setting('app.pessoa_id', true), '');
  v_id   uuid;
BEGIN
  IF v_ator !~ '^operador:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  SELECT id INTO v_id FROM operadores WHERE id = substr(v_ator, 10)::uuid;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION operador_da_sessao() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- O grupo `arquivo`: para onde vai o cliente de um grupo de que a clínica
-- foi removida. Inativo, sem usuário, só o escopo `geral` o enxerga. É o que
-- tira a leitura do grupo NA HORA (RLS por `grupo_id`), cliente e filhas,
-- sem uma policy nova em quarenta tabelas.
-- ---------------------------------------------------------------------------
ALTER TABLE grupos ADD COLUMN arquivo boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX grupos_um_so_arquivo ON grupos ((true)) WHERE arquivo;
INSERT INTO grupos (nome, ativo, arquivo) VALUES ('Encerrados', false, true);

CREATE OR REPLACE FUNCTION grupos_padrao_fixo() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.padrao OR OLD.arquivo THEN
      RAISE EXCEPTION 'o grupo padrão e o de arquivo não se apagam'
        USING ERRCODE = '23514', CONSTRAINT = 'grupo_padrao_fixo';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.padrao AND (NOT NEW.padrao OR NOT NEW.ativo) THEN
    RAISE EXCEPTION 'o grupo padrão não se desativa nem deixa de ser padrão'
      USING ERRCODE = '23514', CONSTRAINT = 'grupo_padrao_fixo';
  END IF;
  IF OLD.arquivo AND (NOT NEW.arquivo OR NEW.ativo OR NEW.padrao) THEN
    RAISE EXCEPTION 'o grupo de arquivo é fixo e inativo'
      USING ERRCODE = '23514', CONSTRAINT = 'grupo_padrao_fixo';
  END IF;
  IF NEW.arquivo AND NOT OLD.arquivo THEN
    RAISE EXCEPTION 'um grupo não vira o de arquivo'
      USING ERRCODE = '23514', CONSTRAINT = 'grupo_padrao_fixo';
  END IF;

  IF (NEW.padrao AND NOT OLD.padrao)
     AND EXISTS (SELECT 1 FROM usuarios_gestao WHERE escopo = 'grupo' AND grupo_id = NEW.id) THEN
    RAISE EXCEPTION 'há Usuário de Gestão de escopo grupo neste grupo; ele não pode ser o padrão'
      USING ERRCODE = '23514', CONSTRAINT = 'usuario_de_gestao_do_grupo_padrao';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION usuario_de_gestao_nao_e_do_grupo_padrao() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.escopo = 'grupo' AND NEW.grupo_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM grupos WHERE id = NEW.grupo_id AND (padrao OR arquivo)) THEN
    RAISE EXCEPTION 'Usuário de Gestão de escopo grupo não pode ser do grupo padrão nem do de arquivo'
      USING ERRCODE = '23514', CONSTRAINT = 'usuario_de_gestao_do_grupo_padrao';
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- `participacao_clinica_grupo`.
-- ---------------------------------------------------------------------------
CREATE TABLE participacao_clinica_grupo (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clinica_id      uuid NOT NULL REFERENCES clinicas(id),
  grupo_id        uuid NOT NULL REFERENCES grupos(id),
  desde           timestamptz NOT NULL DEFAULT now(),
  ate             timestamptz,
  adicionado_por  uuid NOT NULL REFERENCES operadores(id),
  removido_por    uuid REFERENCES operadores(id),
  motivo          text,
  CONSTRAINT participacao_periodo_em_ordem CHECK (ate IS NULL OR ate >= desde),
  CONSTRAINT participacao_remocao_tem_autor CHECK ((ate IS NULL) = (removido_por IS NULL)),
  CONSTRAINT participacao_motivo_curto CHECK (motivo IS NULL OR length(motivo) <= 300)
);
CREATE UNIQUE INDEX participacao_ativa_unica
  ON participacao_clinica_grupo (clinica_id, grupo_id) WHERE ate IS NULL;
CREATE INDEX participacao_por_grupo ON participacao_clinica_grupo (grupo_id) WHERE ate IS NULL;

COMMENT ON TABLE participacao_clinica_grupo IS
  'Em quais grupos a clínica está (ate IS NULL = ativa). Append-only na '
  'prática: nunca DELETE; ate só vai de NULL para um valor, uma vez. Reentrar '
  'é uma linha nova. O grupo padrão (Firmare) nunca sai. O motivo é texto '
  'livre e NUNCA leva dado pessoal.';

-- Semeia o estado de hoje: cada cliente com clínica já "participa" do seu
-- grupo. Não muda ninguém de lugar; só registra o que já é verdade. O autor
-- é quem fez a última mudança de grupo da clínica (ou, sem trilha, o
-- operador mais antigo). Antes do gatilho de regras existir, de propósito.
INSERT INTO participacao_clinica_grupo (clinica_id, grupo_id, desde, adicionado_por, motivo)
SELECT DISTINCT ON (c.clinica_id, c.grupo_id)
       c.clinica_id, c.grupo_id, c.criado_em,
       coalesce(
         (SELECT h.mudado_por FROM historico_grupo_da_clinica h
           WHERE h.clinica_id = c.clinica_id ORDER BY h.mudado_em DESC, h.id DESC LIMIT 1),
         (SELECT id FROM operadores ORDER BY criado_em, id LIMIT 1)
       ),
       'estado anterior à 0068'
  FROM clientes_carteira c
 WHERE c.clinica_id IS NOT NULL AND c.excluido_em IS NULL
   AND coalesce(
         (SELECT h.mudado_por FROM historico_grupo_da_clinica h
           WHERE h.clinica_id = c.clinica_id ORDER BY h.mudado_em DESC, h.id DESC LIMIT 1),
         (SELECT id FROM operadores ORDER BY criado_em, id LIMIT 1)
       ) IS NOT NULL;

ALTER TABLE participacao_clinica_grupo ENABLE ROW LEVEL SECURITY;
ALTER TABLE participacao_clinica_grupo FORCE  ROW LEVEL SECURITY;
-- Cada grupo enxerga só a SUA participação ativa: o grupo A não sabe que a
-- clínica está no B. NUNCA `clinica_id = app_clinica_id()` aqui.
CREATE POLICY participacao_por_grupo ON participacao_clinica_grupo TO fir_carteira
  USING (ate IS NULL AND app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

REVOKE ALL ON participacao_clinica_grupo FROM PUBLIC, fir_app, fir_painel;
GRANT SELECT, INSERT, UPDATE ON participacao_clinica_grupo TO fir_carteira;

CREATE FUNCTION participacao_regras() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_operador uuid := operador_da_sessao();
BEGIN
  IF TG_OP = 'TRUNCATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a participação de uma clínica num grupo não se apaga'
      USING ERRCODE = '23514', CONSTRAINT = 'participacao_append_only';
  END IF;
  IF v_operador IS NULL THEN
    RAISE EXCEPTION 'só o Operador designa ou remove o grupo de uma clínica'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.ate IS NOT NULL OR NEW.removido_por IS NOT NULL THEN
      RAISE EXCEPTION 'a participação nasce ativa' USING ERRCODE = '23514', CONSTRAINT = 'participacao_nasce_ativa';
    END IF;
    IF NEW.adicionado_por IS DISTINCT FROM v_operador THEN
      RAISE EXCEPTION 'o autor da participação é o operador da sessão' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM grupos WHERE id = NEW.grupo_id AND (arquivo OR NOT ativo)) THEN
      RAISE EXCEPTION 'a clínica não entra num grupo inativo nem no de arquivo'
        USING ERRCODE = '23514', CONSTRAINT = 'participacao_grupo_inativo';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: só encerrar, uma vez.
  IF NEW.clinica_id IS DISTINCT FROM OLD.clinica_id OR NEW.grupo_id IS DISTINCT FROM OLD.grupo_id
     OR NEW.desde IS DISTINCT FROM OLD.desde OR NEW.adicionado_por IS DISTINCT FROM OLD.adicionado_por
     OR NEW.motivo IS DISTINCT FROM OLD.motivo THEN
    RAISE EXCEPTION 'a participação não se reescreve' USING ERRCODE = '23514', CONSTRAINT = 'participacao_append_only';
  END IF;
  IF OLD.ate IS NOT NULL OR NEW.ate IS NULL THEN
    RAISE EXCEPTION 'a participação só se encerra, uma vez' USING ERRCODE = '23514', CONSTRAINT = 'participacao_append_only';
  END IF;
  IF NEW.removido_por IS DISTINCT FROM v_operador THEN
    RAISE EXCEPTION 'o autor da remoção é o operador da sessão' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM grupos WHERE id = OLD.grupo_id AND padrao) THEN
    RAISE EXCEPTION 'a clínica não sai do grupo Firmare'
      USING ERRCODE = '23514', CONSTRAINT = 'grupo_padrao_fixo';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION participacao_regras() FROM PUBLIC;

CREATE TRIGGER participacao_regras
  BEFORE INSERT OR UPDATE OR DELETE ON participacao_clinica_grupo
  FOR EACH ROW EXECUTE FUNCTION participacao_regras();
CREATE TRIGGER participacao_sem_truncate
  BEFORE TRUNCATE ON participacao_clinica_grupo
  FOR EACH STATEMENT EXECUTE FUNCTION participacao_regras();
CREATE TRIGGER participacao_clinica_grupo_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON participacao_clinica_grupo
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

-- ---------------------------------------------------------------------------
-- clientes_carteira: um por (grupo, clínica); um que "conta na receita".
-- ---------------------------------------------------------------------------
ALTER TABLE clientes_carteira DROP CONSTRAINT clientes_carteira_clinica_id_key;
CREATE UNIQUE INDEX clientes_carteira_grupo_clinica_unico
  ON clientes_carteira (grupo_id, clinica_id)
  WHERE clinica_id IS NOT NULL AND excluido_em IS NULL;

ALTER TABLE clientes_carteira ADD COLUMN conta_na_receita boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN clientes_carteira.conta_na_receita IS
  'Entre os Clientes Firmare da MESMA clínica (um por grupo), o único que '
  'entra em MRR, cobrança, metas e resumo. Os demais nascem false. Quem decide '
  'qual é: o Operador, com histórico. Nunca inferido.';
CREATE UNIQUE INDEX clientes_carteira_um_que_conta
  ON clientes_carteira (clinica_id)
  WHERE conta_na_receita AND clinica_id IS NOT NULL AND excluido_em IS NULL;

CREATE OR REPLACE FUNCTION clientes_carteira_confere_vinculos() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_ator            text := coalesce(current_setting('app.pessoa_id', true), '');
  v_resp_grupo      uuid;
  v_resp_escopo     text;
  v_resp_ativo      boolean;
  v_muda_vinculo    boolean;
BEGIN
  IF v_ator LIKE 'usuario_gestao:%' THEN
    IF TG_OP = 'INSERT' AND NEW.clinica_id IS NOT NULL THEN
      RAISE EXCEPTION 'só o Operador liga um Cliente Firmare a uma clínica'
        USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.grupo_id IS DISTINCT FROM OLD.grupo_id
                             OR NEW.clinica_id IS DISTINCT FROM OLD.clinica_id
                             OR NEW.conta_na_receita IS DISTINCT FROM OLD.conta_na_receita) THEN
      RAISE EXCEPTION 'só o Operador muda o grupo, a clínica ou quem conta na receita de um Cliente Firmare'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.clinica_id IS NOT NULL
     AND (NEW.clinica_id IS DISTINCT FROM OLD.clinica_id OR NEW.grupo_id IS DISTINCT FROM OLD.grupo_id) THEN
    -- Cliente com clínica é (grupo, clínica) FIXO. A única saída é o
    -- encerramento: excluído E levado ao grupo de arquivo, pelo Operador.
    IF NOT (NEW.clinica_id IS NOT DISTINCT FROM OLD.clinica_id
            AND NEW.excluido_em IS NOT NULL
            AND operador_da_sessao() IS NOT NULL
            AND EXISTS (SELECT 1 FROM grupos WHERE id = NEW.grupo_id AND arquivo)) THEN
      RAISE EXCEPTION 'o grupo e a clínica de um Cliente Firmare não mudam; adicione ou remova o grupo da clínica'
        USING ERRCODE = '23514', CONSTRAINT = 'clientes_carteira_grupo_da_clinica';
    END IF;
  ELSIF NEW.clinica_id IS NOT NULL AND NEW.excluido_em IS NULL
        AND (TG_OP = 'INSERT' OR OLD.clinica_id IS NULL) THEN
    IF NOT EXISTS (SELECT 1 FROM participacao_clinica_grupo p
                    WHERE p.clinica_id = NEW.clinica_id AND p.grupo_id = NEW.grupo_id AND p.ate IS NULL) THEN
      RAISE EXCEPTION 'a clínica não participa deste grupo'
        USING ERRCODE = '23514', CONSTRAINT = 'clientes_carteira_grupo_da_clinica';
    END IF;
  END IF;

  IF NEW.responsavel_usuario_gestao_id IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR NEW.responsavel_usuario_gestao_id IS DISTINCT FROM OLD.responsavel_usuario_gestao_id
          OR NEW.grupo_id IS DISTINCT FROM OLD.grupo_id) THEN
    SELECT u.grupo_id, u.escopo, u.ativo INTO v_resp_grupo, v_resp_escopo, v_resp_ativo
      FROM usuarios_gestao u WHERE u.id = NEW.responsavel_usuario_gestao_id;
    IF NOT FOUND OR NOT v_resp_ativo
       OR (v_resp_escopo = 'grupo' AND v_resp_grupo IS DISTINCT FROM NEW.grupo_id) THEN
      RAISE EXCEPTION 'o responsável Firmare não é deste grupo ou não está ativo'
        USING ERRCODE = '23514', CONSTRAINT = 'clientes_carteira_responsavel_do_grupo';
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- Adicionar a clínica a um grupo: participação, histórico e um Cliente
-- Firmare VAZIO nesse grupo (mensalidade 0, não conta na receita). Só o
-- Operador; ator só da sessão; sem ator, falha ALTO (diferente da 0067).
-- ---------------------------------------------------------------------------
CREATE FUNCTION adicionar_clinica_ao_grupo(p_clinica uuid, p_grupo uuid, p_motivo text)
  RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_operador uuid := operador_da_sessao();
  v_nome     text;
  v_cliente  uuid;
  v_outro    boolean;
BEGIN
  IF v_operador IS NULL THEN
    RAISE EXCEPTION 'só o Operador designa o grupo de uma clínica' USING ERRCODE = '42501';
  END IF;
  IF p_motivo IS NULL OR length(btrim(p_motivo)) < 3 THEN
    RAISE EXCEPTION 'informe o motivo' USING ERRCODE = '23514', CONSTRAINT = 'participacao_motivo_obrigatorio';
  END IF;
  SELECT nome INTO v_nome FROM clinicas WHERE id = p_clinica;
  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'clínica ou grupo inexistente' USING ERRCODE = '23503';
  END IF;
  PERFORM 1 FROM grupos WHERE id = p_grupo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clínica ou grupo inexistente' USING ERRCODE = '23503';
  END IF;

  INSERT INTO historico_grupo_da_clinica (clinica_id, grupo_anterior_id, grupo_novo_id, mudado_por, motivo)
  VALUES (p_clinica, NULL, p_grupo, v_operador, 'grupo adicionado: ' || btrim(p_motivo));
  INSERT INTO participacao_clinica_grupo (clinica_id, grupo_id, adicionado_por, motivo)
  VALUES (p_clinica, p_grupo, v_operador, btrim(p_motivo));

  SELECT EXISTS (SELECT 1 FROM clientes_carteira
                  WHERE clinica_id = p_clinica AND excluido_em IS NULL AND conta_na_receita)
    INTO v_outro;
  INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto, conta_na_receita)
  VALUES (p_grupo, p_clinica, v_nome, 'FIR Clinic', NOT v_outro)
  RETURNING id INTO v_cliente;
  RETURN v_cliente;
END $$;
REVOKE ALL ON FUNCTION adicionar_clinica_ao_grupo(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION adicionar_clinica_ao_grupo(uuid, uuid, text) TO fir_carteira;

-- Encerra a participação (e o histórico). O cliente do grupo é encerrado e
-- levado ao arquivo pelo service, na mesma transação (precisa do mover).
CREATE FUNCTION encerrar_participacao_da_clinica(p_clinica uuid, p_grupo uuid, p_motivo text)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_operador uuid := operador_da_sessao();
BEGIN
  IF v_operador IS NULL THEN
    RAISE EXCEPTION 'só o Operador remove o grupo de uma clínica' USING ERRCODE = '42501';
  END IF;
  IF p_motivo IS NULL OR length(btrim(p_motivo)) < 3 THEN
    RAISE EXCEPTION 'informe o motivo' USING ERRCODE = '23514', CONSTRAINT = 'participacao_motivo_obrigatorio';
  END IF;
  UPDATE participacao_clinica_grupo SET ate = now(), removido_por = v_operador
   WHERE clinica_id = p_clinica AND grupo_id = p_grupo AND ate IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'a clínica não participa deste grupo' USING ERRCODE = '23514', CONSTRAINT = 'participacao_inexistente';
  END IF;
  INSERT INTO historico_grupo_da_clinica (clinica_id, grupo_anterior_id, grupo_novo_id, mudado_por, motivo)
  VALUES (p_clinica, p_grupo, (SELECT id FROM grupos WHERE padrao), v_operador, 'grupo removido: ' || btrim(p_motivo));
END $$;
REVOKE ALL ON FUNCTION encerrar_participacao_da_clinica(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION encerrar_participacao_da_clinica(uuid, uuid, text) TO fir_carteira;

-- Transparência: a CLÍNICA vê quais grupos a recebem (nome e desde), nunca
-- que outras clínicas existem. `fir_app` não tem privilégio na tabela.
CREATE FUNCTION grupos_que_recebem_a_clinica() RETURNS TABLE (grupo text, desde timestamptz)
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public STABLE AS $$
  SELECT g.nome, p.desde
    FROM participacao_clinica_grupo p JOIN grupos g ON g.id = p.grupo_id
   WHERE p.clinica_id = app_clinica_id() AND p.ate IS NULL
   ORDER BY p.desde, g.nome
$$;
REVOKE ALL ON FUNCTION grupos_que_recebem_a_clinica() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION grupos_que_recebem_a_clinica() TO fir_app;

-- ---------------------------------------------------------------------------
-- A clínica nova (0067), agora com participação e com o conflito certo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION clinica_nova_entra_no_grupo_padrao() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_operador uuid := operador_da_sessao();
  v_grupo    uuid;
BEGIN
  IF v_operador IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT id INTO v_grupo FROM grupos WHERE padrao AND ativo;
  IF v_grupo IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO historico_grupo_da_clinica (clinica_id, grupo_anterior_id, grupo_novo_id, mudado_por, motivo)
  VALUES (NEW.id, NULL, v_grupo, v_operador, 'clínica nova');
  INSERT INTO participacao_clinica_grupo (clinica_id, grupo_id, adicionado_por, motivo)
  VALUES (NEW.id, v_grupo, v_operador, 'clínica nova');
  INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto)
  VALUES (v_grupo, NEW.id, NEW.nome, 'FIR Clinic')
  ON CONFLICT (grupo_id, clinica_id) WHERE clinica_id IS NOT NULL AND excluido_em IS NULL DO NOTHING;
  RETURN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- O BACKFILL: todas as clínicas, inclusive inativas, passam a estar no
-- Firmare. NÃO roda na migration: só depois que o dono confirmar o DPA.
-- Só ACRESCENTA: a linha do grupo atual e as filhas não são tocadas; o
-- Cliente Firmare novo nasce VAZIO (sem contato, parceiro, responsável,
-- observação nem mensalidade) e só conta na receita se a clínica não tem
-- outro cliente. Idempotente por índice. Uso (como dono do banco):
--   SELECT * FROM preencher_grupo_firmare('<uuid do operador>');   -- todas
--   (o 2º parâmetro, uma lista de clínicas, serve aos testes e a um ensaio parcial)
-- ---------------------------------------------------------------------------
CREATE FUNCTION preencher_grupo_firmare(p_operador uuid, p_clinicas uuid[] DEFAULT NULL) RETURNS TABLE (clinicas int, participacoes int, clientes int)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_firmare uuid;
  v_c int := 0; v_p int := 0; v_cl int := 0;
  r record;
  v_tem boolean;
BEGIN
  PERFORM 1 FROM operadores WHERE id = p_operador;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'operador inexistente: o histórico exige um autor';
  END IF;
  SELECT id INTO v_firmare FROM grupos WHERE padrao;
  IF v_firmare IS NULL THEN RAISE EXCEPTION 'não há grupo padrão'; END IF;
  PERFORM set_config('app.pessoa_id', 'operador:' || p_operador::text, true);

  FOR r IN SELECT id, nome FROM clinicas WHERE p_clinicas IS NULL OR id = ANY(p_clinicas) ORDER BY id LOOP
    v_c := v_c + 1;
    IF NOT EXISTS (SELECT 1 FROM participacao_clinica_grupo
                    WHERE clinica_id = r.id AND grupo_id = v_firmare AND ate IS NULL) THEN
      INSERT INTO historico_grupo_da_clinica (clinica_id, grupo_anterior_id, grupo_novo_id, mudado_por, motivo)
      VALUES (r.id, NULL, v_firmare, p_operador, 'grupo Firmare contém todas as clínicas');
      INSERT INTO participacao_clinica_grupo (clinica_id, grupo_id, adicionado_por, motivo)
      VALUES (r.id, v_firmare, p_operador, 'grupo Firmare contém todas as clínicas');
      v_p := v_p + 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM clientes_carteira
                    WHERE clinica_id = r.id AND grupo_id = v_firmare AND excluido_em IS NULL) THEN
      SELECT EXISTS (SELECT 1 FROM clientes_carteira
                      WHERE clinica_id = r.id AND excluido_em IS NULL AND conta_na_receita) INTO v_tem;
      INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto, conta_na_receita)
      VALUES (v_firmare, r.id, r.nome, 'FIR Clinic', NOT v_tem);
      v_cl := v_cl + 1;
    END IF;
  END LOOP;
  RETURN QUERY SELECT v_c, v_p, v_cl;
END $$;
REVOKE ALL ON FUNCTION preencher_grupo_firmare(uuid, uuid[]) FROM PUBLIC, fir_carteira, fir_painel, fir_app;

DO $$
BEGIN
  IF has_function_privilege('fir_painel', 'preencher_grupo_firmare(uuid, uuid[])', 'EXECUTE')
     OR has_function_privilege('fir_carteira', 'preencher_grupo_firmare(uuid, uuid[])', 'EXECUTE')
     OR has_function_privilege('fir_app', 'participacao_regras()', 'EXECUTE') THEN
    RAISE EXCEPTION '0068: função interna chamável por papel da aplicação';
  END IF;
  IF (SELECT count(*) FROM grupos WHERE arquivo) <> 1 OR (SELECT count(*) FROM grupos WHERE padrao) <> 1 THEN
    RAISE EXCEPTION '0068: esperava exatamente um grupo padrão e um de arquivo';
  END IF;
END $$;

-- ===========================================================================
-- ENDURECIMENTO DA 0068 (achados do appsec de 10/11/2026). Forward-only: só
-- CREATE OR REPLACE e ALTER FUNCTION; nenhuma linha muda.
--  3. conta_na_receita: lista de PERMISSÃO (só o Operador da sessão altera).
--  4. Usuário do portal não aponta para o grupo padrão nem para o de arquivo.
--  5. search_path fixo, com pg_temp por último, em toda SECURITY DEFINER nova.
--  6. operador_da_sessao exige operadores.ativo.
--  8. Cliente arquivado não volta (nem sem participação ativa).
--  9. Clínica inativa gera cliente 'pausado' (fora do job de uso).
-- ===========================================================================

-- 6 + 5: o operador da sessão precisa estar ativo.
CREATE OR REPLACE FUNCTION operador_da_sessao() RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_ator text := coalesce(current_setting('app.pessoa_id', true), '');
  v_id   uuid;
BEGIN
  IF v_ator !~ '^operador:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  SELECT o.id INTO v_id FROM public.operadores o WHERE o.id = substr(v_ator, 10)::uuid AND o.ativo;
  RETURN v_id;
END $$;

-- 3 + 8: vínculos do Cliente Firmare.
CREATE OR REPLACE FUNCTION clientes_carteira_confere_vinculos() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_ator            text := coalesce(current_setting('app.pessoa_id', true), '');
  v_operador        uuid := public.operador_da_sessao();
  v_resp_grupo      uuid;
  v_resp_escopo     text;
  v_resp_ativo      boolean;
BEGIN
  -- Lista de permissão. Ligar um cliente a uma clínica: o Operador ou o
  -- ator de sistema (semente/fixture). Trocar quem conta na receita: SÓ o
  -- Operador; sistema, vazio, gestão e portal falham.
  IF TG_OP = 'INSERT' AND NEW.clinica_id IS NOT NULL
     AND v_operador IS NULL AND v_ator <> 'sistema' THEN
    RAISE EXCEPTION 'só o Operador liga um Cliente Firmare a uma clínica'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND v_operador IS NULL
     AND (NEW.conta_na_receita IS DISTINCT FROM OLD.conta_na_receita
          OR (v_ator LIKE 'usuario_gestao:%'
              AND (NEW.grupo_id IS DISTINCT FROM OLD.grupo_id
                   OR NEW.clinica_id IS DISTINCT FROM OLD.clinica_id))) THEN
    RAISE EXCEPTION 'só o Operador muda o grupo, a clínica ou quem conta na receita de um Cliente Firmare'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.clinica_id IS NOT NULL
     AND (NEW.clinica_id IS DISTINCT FROM OLD.clinica_id OR NEW.grupo_id IS DISTINCT FROM OLD.grupo_id) THEN
    IF NOT (NEW.clinica_id IS NOT DISTINCT FROM OLD.clinica_id
            AND NEW.excluido_em IS NOT NULL
            AND v_operador IS NOT NULL
            AND EXISTS (SELECT 1 FROM public.grupos WHERE id = NEW.grupo_id AND arquivo)) THEN
      RAISE EXCEPTION 'o grupo e a clínica de um Cliente Firmare não mudam; adicione ou remova o grupo da clínica'
        USING ERRCODE = '23514', CONSTRAINT = 'clientes_carteira_grupo_da_clinica';
    END IF;
  ELSIF NEW.clinica_id IS NOT NULL AND NEW.excluido_em IS NULL
        AND (TG_OP = 'INSERT' OR OLD.clinica_id IS NULL) THEN
    IF NOT EXISTS (SELECT 1 FROM public.participacao_clinica_grupo p
                    WHERE p.clinica_id = NEW.clinica_id AND p.grupo_id = NEW.grupo_id AND p.ate IS NULL) THEN
      RAISE EXCEPTION 'a clínica não participa deste grupo'
        USING ERRCODE = '23514', CONSTRAINT = 'clientes_carteira_grupo_da_clinica';
    END IF;
  END IF;

  -- 8: reativar um cliente excluído.
  IF TG_OP = 'UPDATE' AND OLD.excluido_em IS NOT NULL AND NEW.excluido_em IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.grupos WHERE id = NEW.grupo_id AND arquivo) THEN
      RAISE EXCEPTION 'um Cliente Firmare do grupo de arquivo não é reativado'
        USING ERRCODE = '23514', CONSTRAINT = 'clientes_carteira_arquivo_nao_reativa';
    END IF;
    IF NEW.clinica_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.participacao_clinica_grupo p
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
      FROM public.usuarios_gestao u WHERE u.id = NEW.responsavel_usuario_gestao_id;
    IF NOT FOUND OR NOT v_resp_ativo
       OR (v_resp_escopo = 'grupo' AND v_resp_grupo IS DISTINCT FROM NEW.grupo_id) THEN
      RAISE EXCEPTION 'o responsável Firmare não é deste grupo ou não está ativo'
        USING ERRCODE = '23514', CONSTRAINT = 'clientes_carteira_responsavel_do_grupo';
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- 4: usuário do portal. Só barra quando o vínculo nasce ou muda (trocar a
-- senha de um usuário antigo não pode falhar).
CREATE FUNCTION usuario_do_portal_nao_e_do_grupo_padrao() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.escopo IS NOT DISTINCT FROM OLD.escopo
     AND NEW.grupo_id IS NOT DISTINCT FROM OLD.grupo_id
     AND NEW.cliente_carteira_id IS NOT DISTINCT FROM OLD.cliente_carteira_id THEN
    RETURN NEW;
  END IF;
  IF NEW.escopo = 'grupo' AND NEW.grupo_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.grupos WHERE id = NEW.grupo_id AND (padrao OR arquivo)) THEN
    RAISE EXCEPTION 'Usuário do portal de escopo grupo não pode ser do grupo padrão nem do de arquivo'
      USING ERRCODE = '23514', CONSTRAINT = 'usuario_do_portal_do_grupo_padrao';
  END IF;
  IF NEW.cliente_carteira_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.clientes_carteira c JOIN public.grupos g ON g.id = c.grupo_id
                  WHERE c.id = NEW.cliente_carteira_id AND g.arquivo) THEN
    RAISE EXCEPTION 'Usuário do portal não aponta para cliente do grupo de arquivo'
      USING ERRCODE = '23514', CONSTRAINT = 'usuario_do_portal_do_grupo_padrao';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION usuario_do_portal_nao_e_do_grupo_padrao() FROM PUBLIC;
CREATE TRIGGER usuario_do_portal_nao_e_do_grupo_padrao
  BEFORE INSERT OR UPDATE ON usuarios_do_portal
  FOR EACH ROW EXECUTE FUNCTION usuario_do_portal_nao_e_do_grupo_padrao();

-- 9 + 5: clínica nova; inativa nasce 'pausado'.
CREATE OR REPLACE FUNCTION clinica_nova_entra_no_grupo_padrao() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_operador uuid := public.operador_da_sessao();
  v_grupo    uuid;
BEGIN
  IF v_operador IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT id INTO v_grupo FROM public.grupos WHERE padrao AND ativo;
  IF v_grupo IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.historico_grupo_da_clinica (clinica_id, grupo_anterior_id, grupo_novo_id, mudado_por, motivo)
  VALUES (NEW.id, NULL, v_grupo, v_operador, 'clínica nova');
  INSERT INTO public.participacao_clinica_grupo (clinica_id, grupo_id, adicionado_por, motivo)
  VALUES (NEW.id, v_grupo, v_operador, 'clínica nova');
  INSERT INTO public.clientes_carteira (grupo_id, clinica_id, nome, produto, status)
  VALUES (v_grupo, NEW.id, NEW.nome, 'FIR Clinic', CASE WHEN NEW.ativa THEN 'onboarding' ELSE 'pausado' END)
  ON CONFLICT (grupo_id, clinica_id) WHERE clinica_id IS NOT NULL AND excluido_em IS NULL DO NOTHING;
  RETURN NULL;
END $$;

-- 9 + 5: backfill; clínica inativa gera cliente 'pausado'.
CREATE OR REPLACE FUNCTION preencher_grupo_firmare(p_operador uuid, p_clinicas uuid[] DEFAULT NULL) RETURNS TABLE (clinicas int, participacoes int, clientes int)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_firmare uuid;
  v_c int := 0; v_p int := 0; v_cl int := 0;
  r record;
  v_tem boolean;
BEGIN
  PERFORM 1 FROM public.operadores WHERE id = p_operador AND ativo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'operador inexistente ou inativo: o histórico exige um autor';
  END IF;
  SELECT id INTO v_firmare FROM public.grupos WHERE padrao;
  IF v_firmare IS NULL THEN RAISE EXCEPTION 'não há grupo padrão'; END IF;
  PERFORM set_config('app.pessoa_id', 'operador:' || p_operador::text, true);

  FOR r IN SELECT id, nome, ativa FROM public.clinicas WHERE p_clinicas IS NULL OR id = ANY(p_clinicas) ORDER BY id LOOP
    v_c := v_c + 1;
    IF NOT EXISTS (SELECT 1 FROM public.participacao_clinica_grupo
                    WHERE clinica_id = r.id AND grupo_id = v_firmare AND ate IS NULL) THEN
      INSERT INTO public.historico_grupo_da_clinica (clinica_id, grupo_anterior_id, grupo_novo_id, mudado_por, motivo)
      VALUES (r.id, NULL, v_firmare, p_operador, 'grupo Firmare contém todas as clínicas');
      INSERT INTO public.participacao_clinica_grupo (clinica_id, grupo_id, adicionado_por, motivo)
      VALUES (r.id, v_firmare, p_operador, 'grupo Firmare contém todas as clínicas');
      v_p := v_p + 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.clientes_carteira
                    WHERE clinica_id = r.id AND grupo_id = v_firmare AND excluido_em IS NULL) THEN
      SELECT EXISTS (SELECT 1 FROM public.clientes_carteira
                      WHERE clinica_id = r.id AND excluido_em IS NULL AND conta_na_receita) INTO v_tem;
      INSERT INTO public.clientes_carteira (grupo_id, clinica_id, nome, produto, conta_na_receita, status)
      VALUES (v_firmare, r.id, r.nome, 'FIR Clinic', NOT v_tem, CASE WHEN r.ativa THEN 'onboarding' ELSE 'pausado' END);
      v_cl := v_cl + 1;
    END IF;
  END LOOP;
  RETURN QUERY SELECT v_c, v_p, v_cl;
END $$;

-- 5: demais SECURITY DEFINER da 0068 (corpos inalterados).
ALTER FUNCTION grupos_padrao_fixo() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION usuario_de_gestao_nao_e_do_grupo_padrao() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION participacao_regras() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION adicionar_clinica_ao_grupo(uuid, uuid, text) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION encerrar_participacao_da_clinica(uuid, uuid, text) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION grupos_que_recebem_a_clinica() SET search_path = pg_catalog, public, pg_temp;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef
       AND p.proname IN ('operador_da_sessao','adicionar_clinica_ao_grupo','encerrar_participacao_da_clinica',
                         'grupos_que_recebem_a_clinica','clinica_nova_entra_no_grupo_padrao','preencher_grupo_firmare',
                         'participacao_regras','clientes_carteira_confere_vinculos','grupos_padrao_fixo',
                         'usuario_de_gestao_nao_e_do_grupo_padrao','usuario_do_portal_nao_e_do_grupo_padrao')
       AND NOT coalesce(p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp'], false)
  ) THEN
    RAISE EXCEPTION '0070: SECURITY DEFINER sem search_path fixo';
  END IF;
END $$;

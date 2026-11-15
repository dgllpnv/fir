-- ===========================================================================
-- A CLÍNICA DE QUEM JÁ É CLIENTE (2026-11-15, caso real).
--
-- Criar o Fir de uma clínica cria o Cliente Firmare dela no grupo padrão
-- (0067/0070). Quando a clínica já era cliente da Firmare — cadastrada na
-- carteira antes de ter Fir, sem clínica —, o resultado eram DOIS clientes: o
-- antigo, com o histórico, e o novo, vazio, ligado à clínica. Não havia como
-- juntar: o gatilho de vínculos (0070) não deixa a clínica sair de um cliente.
--
--  1. Prevenir: quem cria a clínica escolhe o cliente que já existe. A
--     transação de criação fixa `app.cliente_da_clinica_nova`; o gatilho liga
--     ESSE cliente (do grupo padrão, sem clínica, não excluído) em vez de
--     criar outro. Cliente inválido aborta a criação inteira.
--  2. Corrigir: `cliente_carteira_so_tem_o_automatico` diz se o cliente que a
--     clínica ganhou sozinha ainda não tem histórico próprio — só então o
--     Operador pode encerrá-lo e ligar o antigo (painel-carteira.service).
-- Forward-only: só CREATE OR REPLACE e CREATE FUNCTION; nenhuma linha muda.
-- ===========================================================================

CREATE OR REPLACE FUNCTION clinica_nova_entra_no_grupo_padrao() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_operador uuid := public.operador_da_sessao();
  v_grupo    uuid;
  v_escolha  text := coalesce(current_setting('app.cliente_da_clinica_nova', true), '');
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

  IF v_escolha <> '' THEN
    IF v_escolha !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'cliente escolhido inválido'
        USING ERRCODE = '23514', CONSTRAINT = 'cliente_da_clinica_nova_invalido';
    END IF;
    UPDATE public.clientes_carteira
       SET clinica_id = NEW.id
     WHERE id = v_escolha::uuid AND grupo_id = v_grupo
       AND clinica_id IS NULL AND excluido_em IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'o cliente escolhido não existe, já tem clínica ou não é do grupo padrão'
        USING ERRCODE = '23514', CONSTRAINT = 'cliente_da_clinica_nova_invalido';
    END IF;
    RETURN NULL;
  END IF;

  INSERT INTO public.clientes_carteira (grupo_id, clinica_id, nome, produto, status)
  VALUES (v_grupo, NEW.id, NEW.nome, 'FIR Clinic', CASE WHEN NEW.ativa THEN 'onboarding' ELSE 'pausado' END)
  ON CONFLICT (grupo_id, clinica_id) WHERE clinica_id IS NOT NULL AND excluido_em IS NULL DO NOTHING;
  RETURN NULL;
END $$;

-- Toda tabela que aponta para o cliente conta como histórico, MENOS o que o
-- sistema grava sozinho (uso diário, sincronização de campanhas) e as
-- trilhas. Lido do catálogo: tabela nova que apontar para o cliente passa a
-- contar sem ninguém lembrar de incluí-la aqui. SECURITY DEFINER porque
-- `fir_carteira` não lê todas; por isso mesmo exige o Operador da sessão.
CREATE FUNCTION cliente_carteira_so_tem_o_automatico(p_cliente uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  r     record;
  v_tem boolean;
BEGIN
  IF public.operador_da_sessao() IS NULL THEN
    RAISE EXCEPTION 'só o Operador' USING ERRCODE = '42501';
  END IF;
  FOR r IN
    SELECT c.conrelid::regclass AS tabela, a.attname AS coluna
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.contype = 'f' AND c.confrelid = 'public.clientes_carteira'::regclass
       AND c.conrelid::regclass::text NOT IN
           ('uso_diario_cliente', 'sincronizacao_campanhas_carteira', 'auditoria_da_carteira', 'clientes_carteira')
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', r.tabela, r.coluna) INTO v_tem USING p_cliente;
    IF v_tem THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION cliente_carteira_so_tem_o_automatico(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cliente_carteira_so_tem_o_automatico(uuid) TO fir_carteira;

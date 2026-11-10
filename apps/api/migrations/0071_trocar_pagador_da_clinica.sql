-- ===========================================================================
-- TROCAR O PAGADOR DA CLÍNICA (T8 do spec clinica-em-varios-grupos, §7 e §8).
-- Forward-only: só uma função nova. Nenhuma linha muda na migration.
--
-- Entre os Clientes Firmare ATIVOS de uma clínica (um por grupo), exatamente um
-- conta na receita (`conta_na_receita`). Esta função move essa marca de um para
-- outro, numa transação, só pelo Operador da sessão.
--
-- NUNCA copia mensalidade, vencimento nem nada comercial: a mensalidade fica
-- onde está. O cliente novo do Firmare nasce com 0; depois da troca o MRR da
-- clínica passa a ser a mensalidade do NOVO pagador, e é o dono quem a lança.
-- ===========================================================================
CREATE FUNCTION trocar_pagador_da_clinica(p_clinica uuid, p_cliente uuid, p_motivo text)
  RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_operador uuid := public.operador_da_sessao();
  v_motivo   text := btrim(coalesce(p_motivo, ''));
  v_novo     record;
  v_antigo   record;
BEGIN
  IF v_operador IS NULL THEN
    RAISE EXCEPTION 'só o Operador troca o pagador de uma clínica' USING ERRCODE = '42501';
  END IF;
  IF length(v_motivo) < 3 OR length(v_motivo) > 300 THEN
    RAISE EXCEPTION 'informe o motivo (3 a 300 caracteres)'
      USING ERRCODE = '23514', CONSTRAINT = 'pagador_motivo_obrigatorio';
  END IF;

  -- O novo pagador: da MESMA clínica, vivo, e o grupo dele ainda a recebe.
  SELECT c.id, c.grupo_id, c.conta_na_receita INTO v_novo
    FROM public.clientes_carteira c
   WHERE c.id = p_cliente AND c.clinica_id = p_clinica AND c.excluido_em IS NULL
     AND EXISTS (SELECT 1 FROM public.participacao_clinica_grupo p
                  WHERE p.clinica_id = c.clinica_id AND p.grupo_id = c.grupo_id AND p.ate IS NULL)
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'o novo pagador precisa ser um cliente ativo desta clínica'
      USING ERRCODE = '23514', CONSTRAINT = 'pagador_cliente_invalido';
  END IF;

  -- Já é quem paga: nada a fazer, nada a gravar (repetir não duplica a trilha).
  IF v_novo.conta_na_receita THEN
    RETURN NULL;
  END IF;

  SELECT c.id, c.grupo_id INTO v_antigo
    FROM public.clientes_carteira c
   WHERE c.clinica_id = p_clinica AND c.excluido_em IS NULL AND c.conta_na_receita
     FOR UPDATE;

  -- O índice único parcial `clientes_carteira_um_que_conta` exige desligar antes.
  IF v_antigo.id IS NOT NULL THEN
    UPDATE public.clientes_carteira SET conta_na_receita = false WHERE id = v_antigo.id;
  END IF;
  UPDATE public.clientes_carteira SET conta_na_receita = true WHERE id = v_novo.id;

  INSERT INTO public.historico_grupo_da_clinica (clinica_id, grupo_anterior_id, grupo_novo_id, mudado_por, motivo)
  VALUES (p_clinica, v_antigo.grupo_id, v_novo.grupo_id, v_operador, 'pagador trocado: ' || v_motivo);

  RETURN v_antigo.id;
END $$;
REVOKE ALL ON FUNCTION trocar_pagador_da_clinica(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION trocar_pagador_da_clinica(uuid, uuid, text) TO fir_carteira;

-- ===========================================================================
-- A RÉGUA DA META, GRAVADA COM A META (spec `integracao-medx.md` C.10; parecer
-- de números N-B6; ticket T7).
--
-- `integracoes_da_clinica.meta_medida_por` (0092) é só o PADRÃO dos meses
-- novos. A régua de cada mês mora na meta: trocar a configuração de FIR para
-- MedX em novembro não muda o atingimento de março a outubro. Ela só muda se
-- alguém editar a meta daquele mês, e isso fica na trilha de `metas_do_mes`.
--
-- Expand: toda meta que já existe foi medida pela FIR.
-- ===========================================================================
SELECT set_config('app.pessoa_id', 'sistema', true);

ALTER TABLE metas_do_mes
  ADD COLUMN medida_por text NOT NULL DEFAULT 'fir' CHECK (medida_por IN ('fir', 'medx'));
COMMENT ON COLUMN metas_do_mes.medida_por IS
  'Com que régua a meta deste mês é medida: o recebido da FIR ou o faturamento lido do MedX. '
  'Copiada da configuração da clínica quando a meta é definida (N-B6).';

-- O balcão lê quando o faturamento do MedX foi lido pela última vez: é o selo
-- "lido do MedX às HH:MM" dos Indicadores (ADR 2026-11-16-faturamento-do-medx).
GRANT SELECT (faturamento_ultimo_sucesso_em, faturamento_releitura_em)
  ON integracoes_da_clinica TO fir_app;

-- ===========================================================================
-- METAS DO MÊS → METAS DE KPI, e o início da conferência por clínica
-- (spec indicadores-e-insights I-26, G1; ticket T2; ADRs
-- 2026-11-17-meta-unica e 2026-11-17-meta-medida-pelos-dias-de-caixa).
--
-- Forward-only. EXPAND + congelamento: `metas_do_mes` fica onde está, só
-- leitura para `fir_app`; o DROP é de uma migration futura (contract).
--
--  1. `clinicas.conferencia_desde`, preenchida com o PRIMEIRO caixa fechado de
--     cada clínica (G1). Clínica sem caixa: NULL, e o primeiro fechamento a
--     preenche na mesma transação (trigger abaixo).
--  2. Um KPI `faturamento_conferido` (`parametros = '{}'`, mensal) por clínica
--     que tem meta. Responsável: o `definida_por` da meta MAIS RECENTE, só se
--     for pessoa da MESMA clínica (appsec C25); senão, sem responsável.
--  3. Cada linha de `metas_do_mes` vira uma meta `mes`, com
--     `origem_migracao = metas_do_mes.id`. Idempotente pelo UNIQUE dela.
--  4. CONFERÊNCIA (números B7): quantidade e soma por clínica, e igualdade
--     LINHA A LINHA com EXCEPT nos dois sentidos. Divergência = RAISE, e a
--     migration inteira volta.
--  5. REVOKE da escrita em `metas_do_mes` para `fir_app`: o PUT antigo falha alto.
-- ===========================================================================
SELECT set_config('app.pessoa_id', 'sistema', true);

-- 1 ------------------------------------------------------------------------
ALTER TABLE clinicas ADD COLUMN conferencia_desde date;
COMMENT ON COLUMN clinicas.conferencia_desde IS
  'O dia do primeiro caixa fechado. A partir dele, a meta e o faturamento conferido '
  'contam só dias com caixa fechado; antes dele, todo o recebido (G1).';

UPDATE clinicas cl
   SET conferencia_desde = p.primeiro
  FROM (SELECT clinica_id, min(dia) AS primeiro FROM caixas_do_dia GROUP BY clinica_id) p
 WHERE p.clinica_id = cl.id AND cl.conferencia_desde IS NULL;

-- `fir_app` não escreve em `clinicas` (0001). O primeiro fechamento preenche a
-- coluna por esta trigger, que é do DONO e só toca a clínica DO caixa: nenhum
-- privilégio novo para a API, e nenhum caminho de inserção de caixa a esquece.
CREATE FUNCTION marcar_conferencia_desde() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE clinicas SET conferencia_desde = NEW.dia
   WHERE id = NEW.clinica_id AND conferencia_desde IS NULL;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION marcar_conferencia_desde() FROM PUBLIC;

CREATE TRIGGER caixas_marcam_conferencia_desde
  AFTER INSERT ON caixas_do_dia
  FOR EACH ROW EXECUTE FUNCTION marcar_conferencia_desde();

-- 2 ------------------------------------------------------------------------
INSERT INTO kpis (clinica_id, origem, chave_catalogo, parametros, nome, frequencia, responsavel_id)
SELECT ult.clinica_id, 'catalogo', 'faturamento_conferido', '{}'::jsonb, 'Faturamento conferido', 'mensal',
       p.id
  FROM (SELECT DISTINCT ON (clinica_id) clinica_id, definida_por
          FROM metas_do_mes
         ORDER BY clinica_id, definida_em DESC, id) ult
  LEFT JOIN pessoas p ON p.id = ult.definida_por AND p.clinica_id = ult.clinica_id
 WHERE NOT EXISTS (
         SELECT 1 FROM kpis k
          WHERE k.clinica_id = ult.clinica_id AND k.origem = 'catalogo'
            AND k.chave_catalogo = 'faturamento_conferido' AND k.parametros = '{}'::jsonb
            AND k.arquivado_em IS NULL);

-- 3 ------------------------------------------------------------------------
-- `definida_por` só atravessa se for pessoa da MESMA clínica: a FK composta de
-- `metas_de_kpi` recusaria a outra, e a conferência abaixo usa a mesma regra.
INSERT INTO metas_de_kpi (clinica_id, kpi_id, tipo, inicio, prazo, alvo_centavos, partida_centavos,
                          responsavel_id, medida_por, origem_migracao, definida_por, definida_em)
SELECT m.clinica_id, k.id, 'mes', m.competencia,
       (date_trunc('month', m.competencia) + interval '1 month - 1 day')::date,
       m.valor, 0, NULL, m.medida_por, m.id, p.id, m.definida_em
  FROM metas_do_mes m
  JOIN kpis k ON k.clinica_id = m.clinica_id AND k.origem = 'catalogo'
             AND k.chave_catalogo = 'faturamento_conferido' AND k.parametros = '{}'::jsonb
             AND k.arquivado_em IS NULL
  LEFT JOIN pessoas p ON p.id = m.definida_por AND p.clinica_id = m.clinica_id
ON CONFLICT (origem_migracao) DO NOTHING;

-- 4 ------------------------------------------------------------------------
-- Uma FUNÇÃO, e não um bloco DO solto: o teste `migracao-0100-meses-trocados-
-- aborta` troca dois meses na cópia e chama a mesma conferência — a prova é
-- da regra que rodou aqui, não de uma cópia dela.
CREATE FUNCTION conferir_migracao_de_metas_do_mes() RETURNS void
  LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  faltando bigint;
  sobrando bigint;
  divergente text;
BEGIN
  WITH antigo AS (
    SELECT m.clinica_id, m.competencia, m.valor, m.medida_por,
           (SELECT p.id FROM pessoas p WHERE p.id = m.definida_por AND p.clinica_id = m.clinica_id) AS definida_por,
           m.definida_em
      FROM metas_do_mes m
  ), novo AS (
    SELECT clinica_id, inicio AS competencia, alvo_centavos AS valor, medida_por, definida_por, definida_em
      FROM metas_de_kpi WHERE origem_migracao IS NOT NULL
  )
  SELECT (SELECT count(*) FROM (SELECT * FROM antigo EXCEPT ALL SELECT * FROM novo) a),
         (SELECT count(*) FROM (SELECT * FROM novo EXCEPT ALL SELECT * FROM antigo) b)
    INTO faltando, sobrando;
  IF faltando <> 0 OR sobrando <> 0 THEN
    RAISE EXCEPTION 'migração de metas_do_mes divergente: % linha(s) sem par na cópia, % linha(s) a mais na cópia',
      faltando, sobrando;
  END IF;

  SELECT string_agg(coalesce(a.clinica_id, n.clinica_id)::text, ', ') INTO divergente
    FROM (SELECT clinica_id, count(*) AS n, sum(valor) AS s FROM metas_do_mes GROUP BY clinica_id) a
    FULL JOIN (SELECT clinica_id, count(*) AS n, sum(alvo_centavos) AS s
                 FROM metas_de_kpi WHERE origem_migracao IS NOT NULL GROUP BY clinica_id) n
      ON n.clinica_id = a.clinica_id
   WHERE a.n IS DISTINCT FROM n.n OR a.s IS DISTINCT FROM n.s;
  IF divergente IS NOT NULL THEN
    RAISE EXCEPTION 'migração de metas_do_mes: quantidade ou soma diverge nas clínicas %', divergente;
  END IF;
END $$;
REVOKE ALL ON FUNCTION conferir_migracao_de_metas_do_mes() FROM PUBLIC;

SELECT conferir_migracao_de_metas_do_mes();

-- 5 ------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON metas_do_mes FROM fir_app;
COMMENT ON TABLE metas_do_mes IS
  'CONGELADA pela 0100: a meta do mês mora em metas_de_kpi. Só leitura para fir_app; '
  'o DROP é de uma migration futura.';

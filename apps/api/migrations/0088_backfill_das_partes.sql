-- ---------------------------------------------------------------------------
-- BACKFILL DAS PARTES — uma parte por recebimento com valor > 0 (fatia 4.1).
--
-- Expand/contract: a 0086 criou a tabela; aqui os recebimentos que já existem
-- ganham a parte única com a forma e o valor deles, INCLUSIVE `forma = ''` (o
-- dado migrado da v20, 0021: entra na receita e fica fora do caixa). A venda a
-- prazo (valor = 0) não tem parte. Idempotente: quem já tem parte (o
-- recebimento nascido entre a 0086 e esta) fica como está.
--
-- A CONFERÊNCIA É PARTE DA MIGRATION, não de um teste que alguém lembra de
-- rodar (regra 28): se a contagem ou a soma por clínica não bater, a migration
-- inteira desfaz — dinheiro que perdeu a forma não vai para produção.
--
-- `fir_migrate` tem BYPASSRLS, e a trilha (trigger) assina como 'sistema'.
-- ---------------------------------------------------------------------------
SELECT set_config('app.pessoa_id', 'sistema', true);

INSERT INTO recebimento_partes (clinica_id, recebimento_id, forma, valor)
SELECT r.clinica_id, r.id, r.forma, r.valor
  FROM recebimentos r
 WHERE r.valor > 0
   AND NOT EXISTS (SELECT 1 FROM recebimento_partes p WHERE p.recebimento_id = r.id);

DO $$
DECLARE
  v_recebimentos bigint;
  v_com_parte    bigint;
  v_ruins        bigint;
BEGIN
  -- 1. Contagem: todo recebimento com valor tem parte, e nenhum sem valor tem.
  SELECT count(*) INTO v_recebimentos FROM recebimentos WHERE valor > 0;
  SELECT count(DISTINCT p.recebimento_id) INTO v_com_parte FROM recebimento_partes p;
  IF v_recebimentos <> v_com_parte THEN
    RAISE EXCEPTION 'backfill das partes: % recebimentos com valor e % com parte', v_recebimentos, v_com_parte;
  END IF;

  -- 2. Soma por recebimento (e portanto por clínica): Σ partes = valor.
  SELECT count(*) INTO v_ruins
    FROM recebimentos r
    LEFT JOIN (SELECT recebimento_id, sum(valor) AS soma FROM recebimento_partes GROUP BY recebimento_id) p
           ON p.recebimento_id = r.id
   WHERE coalesce(p.soma, 0) <> r.valor;
  IF v_ruins > 0 THEN
    RAISE EXCEPTION 'backfill das partes: % recebimento(s) com soma das partes diferente do valor', v_ruins;
  END IF;

  -- 3. Σ por clínica, a conferência da regra 28 nas duas pontas.
  SELECT count(*) INTO v_ruins FROM (
    SELECT clinica_id,
           (SELECT coalesce(sum(valor), 0) FROM recebimentos r2 WHERE r2.clinica_id = c.clinica_id) AS a,
           (SELECT coalesce(sum(valor), 0) FROM recebimento_partes p2 WHERE p2.clinica_id = c.clinica_id) AS b
      FROM (SELECT DISTINCT clinica_id FROM recebimentos) c
  ) x WHERE x.a <> x.b;
  IF v_ruins > 0 THEN
    RAISE EXCEPTION 'backfill das partes: % clínica(s) com receita diferente da soma das partes', v_ruins;
  END IF;
END $$;

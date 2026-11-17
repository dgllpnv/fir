-- ---------------------------------------------------------------------------
-- O NÚMERO DO LANÇAMENTO MORA NA COLUNA DA UNIDADE ATUAL DO KPI (validação X1).
-- Expand-only: uma função e um trigger, sem tocar em coluna nem em linha.
--
-- `reais` grava em `valor_centavos`; toda outra unidade grava em `valor_numero`.
-- O CHECK da 0098 já garante "uma coluna só"; ele não sabe QUAL, porque a unidade
-- mora em `kpis`. Sem este trigger, uma troca de unidade concorrente com um
-- lançamento deixava 12 pacientes em `valor_numero` de um KPI em reais, e a
-- leitura devolvia nulo — o número sumia do cartão e da meta.
--
-- A primeira camada é o `editarKpi` travar o KPI (FOR UPDATE) antes de conferir
-- os lançamentos. Esta é a segunda: o `FOR SHARE` serializa o lançamento contra
-- uma troca de unidade em andamento e lê a unidade já confirmada.
-- KPI de catálogo (unidade nula) não recebe lançamento: também é recusado.
-- ---------------------------------------------------------------------------
SELECT set_config('app.pessoa_id', 'sistema', true);

CREATE FUNCTION lancamento_na_coluna_da_unidade() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  unidade_do_kpi text;
BEGIN
  SELECT k.unidade INTO unidade_do_kpi
    FROM kpis k
   WHERE k.id = NEW.kpi_id AND k.clinica_id = NEW.clinica_id
     FOR SHARE;

  IF unidade_do_kpi IS NULL
     OR (unidade_do_kpi = 'reais' AND NEW.valor_centavos IS NULL)
     OR (unidade_do_kpi <> 'reais' AND NEW.valor_numero IS NULL) THEN
    RAISE EXCEPTION 'lancamento_na_coluna_da_unidade: o valor não está na coluna da unidade do KPI'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'lancamento_na_coluna_da_unidade';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER lancamento_na_coluna_da_unidade
  BEFORE INSERT OR UPDATE OF kpi_id, clinica_id, valor_centavos, valor_numero ON lancamentos_de_kpi
  FOR EACH ROW EXECUTE FUNCTION lancamento_na_coluna_da_unidade();

-- ===========================================================================
-- OKRS — de 1 a 5 resultados-chave vivos por OKR vivo (spec E.2, ticket T4).
--
-- A 0098 criou `okrs` e `resultados_chave` e deixou a trigger para cá: ela só
-- faz sentido junto da rota que cria o OKR e os KRs na MESMA transação.
--
-- Duas peças:
--
--  1. CONSTRAINT TRIGGER, DEFERRABLE INITIALLY DEFERRED, nas duas tabelas. A
--     contagem é conferida no fim da transação: o OKR nasce antes dos KRs, e
--     trocar a lista arquiva um KR antes de criar o outro — no meio, a conta
--     passa por 0 ou por 6 sem estar errada. O serviço faz `SET CONSTRAINTS
--     okr_de_1_a_5_krs IMMEDIATE` no fim da escrita, para o erro sair como 422
--     e não no COMMIT. A trigger trava a linha do OKR antes de contar: duas
--     abas que acrescentam um KR cada uma não passam juntas do 5.
--     OKR arquivado não é conferido (arquivar leva os KRs junto).
--
--  2. O mesmo KPI não aparece duas vezes entre os KRs VIVOS de um OKR. Em dois
--     OKRs, pode — e cada KR tem a sua meta (o EXCLUDE da 0098 inclui
--     `resultado_chave_id`; CONTEXT.md, `Meta de KPI`).
--
-- Expand puro: nada existente muda (as tabelas estão vazias até o T4).
-- ===========================================================================
SELECT set_config('app.pessoa_id', 'sistema', true);

CREATE FUNCTION conferir_krs_do_okr() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_okr  uuid;
  v_vivo boolean;
  v_n    integer;
BEGIN
  IF TG_TABLE_NAME = 'okrs' THEN
    v_okr := NEW.id;
  ELSE
    v_okr := NEW.okr_id;
  END IF;

  SELECT arquivado_em IS NULL INTO v_vivo FROM okrs WHERE id = v_okr FOR UPDATE;
  IF NOT coalesce(v_vivo, false) THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO v_n FROM resultados_chave WHERE okr_id = v_okr AND arquivado_em IS NULL;
  IF v_n < 1 OR v_n > 5 THEN
    -- Sem texto do usuário na mensagem (LGPD R-e): só a contagem.
    RAISE EXCEPTION 'OKR com % resultados-chave vivos; são de 1 a 5', v_n
      USING ERRCODE = '23514', CONSTRAINT = 'okr_de_1_a_5_krs';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER okr_de_1_a_5_krs
  AFTER INSERT OR UPDATE ON okrs
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION conferir_krs_do_okr();

CREATE CONSTRAINT TRIGGER okr_de_1_a_5_krs
  AFTER INSERT OR UPDATE ON resultados_chave
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION conferir_krs_do_okr();

CREATE UNIQUE INDEX kpi_uma_vez_por_okr
  ON resultados_chave (clinica_id, okr_id, kpi_id)
  WHERE arquivado_em IS NULL;

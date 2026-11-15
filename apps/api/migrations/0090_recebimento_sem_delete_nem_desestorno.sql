-- ---------------------------------------------------------------------------
-- ENDURECIMENTO R3 de `recebimentos` (revisão da fatia 4).
--
-- 1. `fir_app` perde DELETE. Nenhum caminho do produto apaga recebimento: o
--    estorno é marca (`estornado_em`, regra 20), e os 5 caminhos que desfazem
--    dinheiro gravam a marca. Quem apaga é só a limpeza de clínica de teste,
--    que roda como o DONO (`fir_migrate`) — e é por isso que as partes têm
--    ON DELETE CASCADE a partir do pai.
--
-- 2. Estorno não se desfaz: `estornado_em` NOT NULL → NULL é recusado. Desfazer
--    um estorno ressuscitaria dinheiro que o caixa já conferiu fora, e o
--    caminho certo é lançar de novo (a trilha conta as duas coisas).
--
--    O DONO do esquema (`fir_migrate`, `fir`) fica fora da trigger, pela mesma
--    lista de permitidos da parte única implícita (0086): um teste da carteira
--    (`campanhas-carteira.e2e.test.ts`) monta o cenário "desestornando" como
--    dono, e o dono pode desligar a trigger de qualquer forma. Para a
--    aplicação, que é quem pode ter o bug, a trigger vale sempre.
-- ---------------------------------------------------------------------------
SELECT set_config('app.pessoa_id', 'sistema', true);

REVOKE DELETE, TRUNCATE ON recebimentos FROM fir_app;

CREATE FUNCTION recebimento_estorno_nao_se_desfaz() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estornado_em IS NOT NULL AND NEW.estornado_em IS NULL
     AND current_user NOT IN ('fir_migrate', 'fir') THEN
    RAISE EXCEPTION 'recebimento estornado não volta: lance de novo';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER recebimentos_estorno_nao_se_desfaz
  BEFORE UPDATE OF estornado_em ON recebimentos
  FOR EACH ROW EXECUTE FUNCTION recebimento_estorno_nao_se_desfaz();

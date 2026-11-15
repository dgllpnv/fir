-- ---------------------------------------------------------------------------
-- DIFERENÇA RECONHECIDA — o inventário que a gestão VIU e aceitou.
--
-- Por que NÃO é um movimento `ajuste` (decisão do dono, 2026-11-14): o saldo é
-- "última contagem + movimentos depois" (regra 11), então concluir a contagem
-- JÁ fixa o saldo no contado. Um `ajuste` gravado depois soma por cima e
-- DOBRA a diferença (anterior 10, contado 8, ajuste −2 → saldo 6, e a próxima
-- análise acusa +2 fantasma); gravado antes, reescreve o esperado da análise
-- e viola a regra 13. Esta tabela é só o RECONHECIMENTO: efeito zero no saldo,
-- nenhuma função de saldo a lê.
--
--  * `diferenca_milesimos` é CONGELADA: o que a análise mostrava quando a
--    pessoa reconheceu. O servidor a recalcula (nunca confia no cliente).
--  * `lote` nulo = a diferença do ITEM (a análise é por item). A coluna existe
--    para o dia em que a análise passar a ser por lote, sem migration.
--  * Único `(contagem, item, lote)` com NULLS NOT DISTINCT: duplo clique e
--    duas abas geram UMA linha — a idempotência é do esquema.
--  * Append-only: `fir_app` lê e insere. Reconhecer não se desfaz.
-- ---------------------------------------------------------------------------
CREATE TABLE diferencas_reconhecidas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id  uuid NOT NULL REFERENCES clinicas(id),
  contagem_id uuid NOT NULL,
  item_id     uuid NOT NULL,
  lote        date,
  -- Assinado, em milésimos de `medida`. Zero não é diferença: não há o que reconhecer.
  diferenca_milesimos bigint NOT NULL CHECK (diferenca_milesimos <> 0),
  motivo      text NOT NULL DEFAULT 'Inventário' CHECK (motivo = 'Inventário'),
  reconhecida_por uuid NOT NULL,
  em          timestamptz NOT NULL DEFAULT now(),

  -- FKs COMPOSTAS com a clínica: sem ela, o id da vizinha passaria na
  -- referência e a RLS só esconderia a leitura.
  CONSTRAINT diferenca_e_de_contagem_da_clinica
    FOREIGN KEY (clinica_id, contagem_id) REFERENCES contagens_de_estoque (clinica_id, id),
  CONSTRAINT diferenca_e_de_item_da_clinica
    FOREIGN KEY (clinica_id, item_id) REFERENCES itens_de_estoque (clinica_id, id),
  CONSTRAINT diferenca_e_de_pessoa_da_clinica
    FOREIGN KEY (clinica_id, reconhecida_por) REFERENCES pessoas (clinica_id, id)
);

CREATE UNIQUE INDEX diferenca_reconhecida_unica
  ON diferencas_reconhecidas (contagem_id, item_id, lote) NULLS NOT DISTINCT;
CREATE INDEX diferencas_por_contagem ON diferencas_reconhecidas (clinica_id, contagem_id);

COMMENT ON TABLE diferencas_reconhecidas IS
  'APPEND-ONLY. Registro de que a gestão viu a diferença de um item numa '
  'contagem CONCLUÍDA. EFEITO ZERO NO SALDO: não é movimento, e nenhuma função '
  'de saldo a lê (concluir a contagem já fixou o saldo no contado).';

ALTER TABLE diferencas_reconhecidas ENABLE ROW LEVEL SECURITY;
ALTER TABLE diferencas_reconhecidas FORCE  ROW LEVEL SECURITY;
CREATE POLICY diferencas_reconhecidas_por_clinica ON diferencas_reconhecidas
  USING (clinica_id = app_clinica_id()) WITH CHECK (clinica_id = app_clinica_id());

CREATE TRIGGER diferencas_reconhecidas_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON diferencas_reconhecidas
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

-- O `ALTER DEFAULT PRIVILEGES` do bootstrap concede os quatro; o REVOKE é que
-- faz o append-only (mesmo par de camadas de `movimentos_de_estoque`).
GRANT SELECT, INSERT ON diferencas_reconhecidas TO fir_app;
REVOKE UPDATE, DELETE, TRUNCATE ON diferencas_reconhecidas FROM fir_app;

-- Camada 2: a trigger alcança o DONO, que o REVOKE não alcança.
CREATE FUNCTION diferenca_reconhecida_e_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'diferença reconhecida é append-only: % recusado', TG_OP;
END $$;

CREATE TRIGGER diferencas_reconhecidas_sem_update
  BEFORE UPDATE OR DELETE OR TRUNCATE ON diferencas_reconhecidas
  FOR EACH STATEMENT EXECUTE FUNCTION diferenca_reconhecida_e_append_only();

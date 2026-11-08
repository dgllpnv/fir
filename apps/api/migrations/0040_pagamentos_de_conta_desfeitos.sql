-- ---------------------------------------------------------------------------
-- DESFAZER O PAGAMENTO DE UMA CONTA A PAGAR (D-21, item 4).
--
-- O Paguei registrado errado — valor trocado, conta errada, dia errado — não
-- tinha correção: conta paga não se exclui (ela faz parte do resultado do mês)
-- e o pagamento não se edita. "Desfazer pagamento" volta a conta para aberta
-- (limpa `pago_em`, `valor_pago`, `forma_pagamento`, `pago_por`) e o que foi
-- desfeito vem PARA CÁ, na mesma transação.
--
-- Por que uma tabela própria, e não só a trilha de `auditoria`: a trilha diz
-- de → para coluna a coluna, mas responder "quanto saiu do resultado de
-- setembro por correção, e por quê" exigiria remontar o pagamento a partir de
-- um diff genérico. Aqui ele fica inteiro, com o MOTIVO, e com a CATEGORIA e o
-- VENCIMENTO do instante do desfazer — a conta pode ser editada depois, e o
-- registro do que foi corrigido não pode mudar junto.
--
-- APPEND-ONLY nas duas camadas, como `movimentos_de_estoque` (0015):
--   1. privilégio: `fir_app` só lê e insere;
--   2. trigger por STATEMENT que recusa UPDATE/DELETE/TRUNCATE — alcança o
--      dono (`fir_migrate`, BYPASSRLS), que o REVOKE não alcança.
-- Desfazer um desfazer é PAGAR DE NOVO a conta, nunca apagar esta linha.
--
-- Expand puro: tabela nova, nenhuma coluna existente muda de sentido.
-- ---------------------------------------------------------------------------
SELECT set_config('app.pessoa_id', 'sistema', true);

CREATE TABLE pagamentos_de_conta_desfeitos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id      uuid NOT NULL REFERENCES clinicas(id),
  conta_id        uuid NOT NULL REFERENCES contas_a_pagar(id),

  -- O PAGAMENTO desfeito, exatamente como estava na conta.
  pago_em         date NOT NULL,
  valor_pago      bigint NOT NULL CHECK (valor_pago > 0),
  forma_pagamento text NOT NULL DEFAULT '' CHECK (length(forma_pagamento) <= 30),
  -- Nulo só se a conta veio assim da migração da v20.
  pago_por        uuid REFERENCES pessoas(id),

  -- A conta no INSTANTE do desfazer (a conta continua editável depois).
  categoria       text NOT NULL CHECK (length(categoria) <= 40),
  vencimento      date NOT NULL,

  motivo          text NOT NULL CHECK (length(btrim(motivo)) BETWEEN 3 AND 200),
  desfeito_por    uuid NOT NULL REFERENCES pessoas(id),
  desfeito_em     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pagamentos_desfeitos_por_conta
  ON pagamentos_de_conta_desfeitos (clinica_id, conta_id);

COMMENT ON TABLE pagamentos_de_conta_desfeitos IS
  'APPEND-ONLY. Cada linha é um Paguei desfeito: o pagamento como estava, a '
  'categoria e o vencimento da conta no instante, o motivo e quem desfez. '
  'Σ pagamentos registrados = Σ pagos vivos + Σ desfeitos.';

-- CAMADA 1: o privilégio. O `ALTER DEFAULT PRIVILEGES` do bootstrap concede os
-- quatro; quem faz o trabalho é o REVOKE.
GRANT SELECT, INSERT ON pagamentos_de_conta_desfeitos TO fir_app;
REVOKE UPDATE, DELETE, TRUNCATE ON pagamentos_de_conta_desfeitos FROM fir_app;

-- CAMADA 2: a trigger, que alcança o DONO. `FOR EACH STATEMENT`: a recusa não
-- depende de haver linha afetada.
CREATE FUNCTION pagamento_desfeito_e_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'pagamento desfeito é append-only: % recusado', TG_OP
    USING HINT = 'Para corrigir, pague a conta de novo; o registro do desfazer não muda.';
END $$;

CREATE TRIGGER pagamentos_desfeitos_sem_update
  BEFORE UPDATE OR DELETE OR TRUNCATE ON pagamentos_de_conta_desfeitos
  FOR EACH STATEMENT EXECUTE FUNCTION pagamento_desfeito_e_append_only();

-- RLS + TRILHA. `FORCE` para que nem o dono escape; a policy filtra por
-- clínica com AND e nada mais (`isolamento-de-clinica.test.ts` recusa `OR`).
ALTER TABLE pagamentos_de_conta_desfeitos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagamentos_de_conta_desfeitos FORCE  ROW LEVEL SECURITY;
CREATE POLICY pagamentos_de_conta_desfeitos_por_clinica ON pagamentos_de_conta_desfeitos
  USING (clinica_id = app_clinica_id())
  WITH CHECK (clinica_id = app_clinica_id());
CREATE TRIGGER pagamentos_de_conta_desfeitos_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON pagamentos_de_conta_desfeitos
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

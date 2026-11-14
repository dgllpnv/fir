-- Chave de idempotência da criação de conta ("Conta já paga" cria e paga numa
-- chamada só). Sem ela, um duplo toque criaria duas contas e duas despesas
-- pagas. Mesmo padrão de recebimentos.requisicao_id: parcial, porque contas
-- antigas e criadas sem chave continuam válidas.
ALTER TABLE contas_a_pagar ADD COLUMN requisicao_id uuid;
CREATE UNIQUE INDEX conta_por_requisicao ON contas_a_pagar (clinica_id, requisicao_id)
  WHERE requisicao_id IS NOT NULL;

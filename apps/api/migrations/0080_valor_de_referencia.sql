-- VALOR DE REFERÊNCIA — o valor que a lista importada da campanha trazia junto
-- do nome ("Maria Souza - R$ 15.200": o que a paciente faturou ou
-- orçou antes, e que justifica o recontato).
--
-- EXPAND: só acrescenta coluna, anulável. Sem preenchimento retroativo: o que
-- foi importado antes não guardou o valor, e não há como reconstruí-lo.
--
-- NÃO É RECEITA (regras 3 e 4): nunca entra em recebido, LTV, meta nem em
-- `valorConvertido`. Receita é `recebimentos.valor`. É dinheiro para efeito de
-- REDAÇÃO (regra 17): o nome da chave está em CAMPOS_MONETARIOS.
--
-- RLS e trilha de auditoria: a coluna mora em `tarefas`, que já tem as duas
-- (policy por clinica_id e gatilho de trilha sobre a linha inteira).
ALTER TABLE tarefas
  ADD COLUMN valor_de_referencia bigint
    CHECK (valor_de_referencia IS NULL OR valor_de_referencia >= 0);

COMMENT ON COLUMN tarefas.valor_de_referencia IS
  'Centavos lidos da lista importada da campanha, ao lado do nome. Só informa; '
  'NÃO É RECEITA (regras 3 e 4). NULL = a linha não trazia valor legível.';

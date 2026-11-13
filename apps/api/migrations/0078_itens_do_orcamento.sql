-- ITENS DO ORÇAMENTO — o conceito próprio, separado de "programa".
--
-- Até aqui, os procedimentos de um orçamento só existiam dentro de
-- `programa_orcado`, que é a proposta de um PROGRAMA (sessões, intervalo,
-- encadeamento). Um orçamento que só lista "limpeza, clareamento, faceta" não
-- é programa, e sem esta coluna a recepção não tinha onde guardar a lista — e
-- o fechamento parcial não tinha o que perguntar ("quais foram fechados?").
--
-- EXPAND: só acrescenta coluna. Sem preenchimento retroativo: o orçamento que
-- já tem `programa_orcado` continua com ele, e os itens são LIDOS dali
-- (migração por leitura). `itens_orcamento` é só para o orçamento SEM programa;
-- os dois nunca andam juntos (CHECK abaixo).
--
-- Cada item: {chave, procedimentoId, valor?} — `valor` em centavos EM TEXTO
-- (D-4). NÃO É RECEITA (regra 4).
ALTER TABLE tarefas ADD COLUMN itens_orcamento jsonb;

ALTER TABLE tarefas ADD CONSTRAINT itens_so_sem_programa CHECK (
  itens_orcamento IS NULL OR programa_orcado IS NULL);

ALTER TABLE tarefas ADD CONSTRAINT itens_so_com_etapa CHECK (
  itens_orcamento IS NULL OR etapa IN ('orcamento','fechado','perdido'));

COMMENT ON COLUMN tarefas.itens_orcamento IS
  'Procedimentos listados no orçamento SEM programa: [{chave, procedimentoId, '
  'valor?}], valor em centavos texto. Orçamento com programa_orcado lê os '
  'itens dali. Nunca os dois. NÃO É RECEITA (regra 4).';

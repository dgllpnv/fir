-- ORÇAMENTO PARCIAL — o valor que a paciente realmente FECHOU.
--
-- `valor_orcamento` é o que a clínica OFERECEU e não é sobrescrito no
-- fechamento (decisão antiga: o funil mede o tamanho da proposta). Só que o
-- total fechado (entrada + saldo em aberto) não ficava guardado em lugar
-- nenhum, e então "ofertou 25 mil, fechou 15 mil" era indistinguível de
-- "fechou os 25 mil e ficou com saldo". A cliente quer o primeiro como
-- ORÇAMENTO PARCIAL.
--
-- EXPAND: só acrescenta coluna. Sem preenchimento retroativo: o que se fechou
-- antes desta migration não tem como ser reconstruído com segurança, e fica
-- como "sem informação" (NULL), nunca como parcial por palpite.
--
-- NÃO É RECEITA (regra 4): mede o tamanho do negócio fechado. Receita é
-- `recebimentos.valor`.
ALTER TABLE tarefas
  ADD COLUMN valor_fechado bigint CHECK (valor_fechado IS NULL OR valor_fechado > 0);

COMMENT ON COLUMN tarefas.valor_fechado IS
  'Centavos fechados pela paciente (entrada + saldo em aberto), gravado no '
  'fechamento. Menor que valor_orcamento = orçamento parcial. NULL = fechado '
  'antes desta coluna, ou ainda não fechado. NÃO É RECEITA (regra 4).';

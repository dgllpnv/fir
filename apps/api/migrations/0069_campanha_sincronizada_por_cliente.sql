-- ===========================================================================
-- A campanha sincronizada é uma cópia POR CLIENTE (0068).
-- Com um Cliente Firmare por (grupo, clínica), a mesma campanha da clínica é
-- materializada uma vez em cada grupo que a recebe. O índice da 0043 só
-- admitia UMA cópia por (campanha, mês), então o segundo grupo nunca recebia
-- nada e o job falhava a cada rodada. A chave passa a incluir o cliente.
-- A isolação continua pela RLS por `grupo_id`; o `geral` deduplica por
-- (campanha, mês) ao somar (um-por-clinica.ts).
-- ===========================================================================
DROP INDEX campanhas_carteira_por_origem_e_mes;
CREATE UNIQUE INDEX campanhas_carteira_por_cliente_origem_e_mes
  ON campanhas_carteira (cliente_carteira_id, campanha_origem_id, mes_referencia)
  WHERE campanha_origem_id IS NOT NULL;

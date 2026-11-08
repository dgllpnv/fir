-- ---------------------------------------------------------------------------
-- A FORMA PREVISTA DA CONTA A PAGAR (ADR 0020).
--
-- Duas colunas, dois significados, e nunca uma no lugar da outra:
--
--   forma_prevista   o que a clínica ESPERA usar (o boleto do aluguel). Vem do
--                    cadastro, e a renovação mensal a copia;
--   forma_pagamento  o que de FATO saiu, gravado no Paguei (0009). Só ela entra
--                    no relatório "Pago por forma" e no filtro de uma paga.
--
-- O servidor NUNCA preenche `forma_pagamento` a partir desta coluna: a tela
-- pré-preenche o Paguei com a prevista e a pessoa confirma ou troca. Um
-- fallback no servidor gravaria "Boleto" para o pagamento que saiu por Pix no
-- primeiro campo limpo de propósito, e o extrato deixaria de conferir.
--
-- `text` e não ENUM, com o mesmo tamanho de `forma_pagamento`: acrescentar uma
-- forma (Cartão de débito entrou agora) não pode exigir migration. A lista
-- válida é `FORMAS_DE_SAIDA`, cobrada na borda Zod. `''` = "não prevista".
--
-- Expand puro: coluna nova com DEFAULT, nenhuma linha existente muda de
-- sentido, e a versão anterior da API continua funcionando sem conhecê-la.
-- ---------------------------------------------------------------------------
SELECT set_config('app.pessoa_id', 'sistema', true);

ALTER TABLE contas_a_pagar
  ADD COLUMN forma_prevista text NOT NULL DEFAULT ''
    CHECK (length(forma_prevista) <= 30);

COMMENT ON COLUMN contas_a_pagar.forma_prevista IS
  'A forma que a clinica ESPERA usar ('''' = nao prevista). A renovacao mensal '
  'a copia; o Paguei NUNCA a usa como fallback de forma_pagamento (ADR 0020).';

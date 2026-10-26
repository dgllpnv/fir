-- ---------------------------------------------------------------------------
-- D-9 — PROGRAMA SEM ENTRADA ABRE SALDO.
--
-- A clínica fecha um programa de R$ 3.600, a paciente não paga nada hoje e
-- fica devendo tudo. **O protótipo aceita** — "fechou, paga depois" — e
-- representa o saldo com valor recebido vazio e `valorAberto: 3600`. Medido
-- em `criarAdesao` com `valorEntrada: ""`:
--
--     {valor: "", valorAberto: 3600, formaPagamento: "", modo: "saldo"}
--
-- O `CHECK (valor > 0)` da 0006 impedia isso: sem entrada não havia linha, e
-- sem linha não havia dívida registrada — a clínica vendia R$ 3.600 e o
-- sistema registrava zero.
--
-- A troca, decidida pelo dono em 2026-10-26 (`docs/decisoes.md`, D-9):
--
--   `CHECK (valor > 0 OR valor_aberto > 0)`
--
-- A linha é aceita quando registra **alguma coisa** — dinheiro recebido **ou**
-- dinheiro devido.
--
-- POR QUE NÃO `valor >= 0`: aquilo aceitaria uma linha completamente vazia,
-- que não registra nada e ainda assim ocupa espaço na ficha da paciente.
--
-- AS DUAS CONSTRAINTS QUE ESTA MIGRATION ACRESCENTA ALÉM DA DECISÃO, e nenhuma
-- delas é zelo:
--
--  1. `recebimento_valor_nao_negativo`. O `valor > 0` original carregava a
--     não-negatividade DE GRAÇA. `valor > 0 OR valor_aberto > 0` sozinho
--     aceitaria `(valor = -500, valor_aberto = 1000)` — e um recebimento
--     negativo subtrai da receita do dia sem passar por estorno, que é
--     precisamente o caminho que a regra 20 fecha.
--
--  2. `recebimento_forma_so_com_dinheiro`. Não existe forma de pagamento para
--     dinheiro que não se moveu, e o protótipo concorda: ele grava
--     `formaPagamento: ""` quando a entrada é zero, e o `fecharCaixa` filtra
--     por `Number(t.valor) > 0 && t.formaPagamento` — as DUAS metades. A
--     bicondicional aqui é o que impede "Pix" num recebimento de R$ 0,00, que
--     apareceria como um Pix que ninguém fez no primeiro lugar que parasse de
--     filtrar.
--
-- A CONDIÇÃO SEM A QUAL A DECISÃO NÃO VALE, e ela não mora nesta migration:
-- a linha de valor zero não aparece no CAIXA DO DIA, na LISTA DE RECEBIMENTOS
-- DO DIA nem no LTV DA PACIENTE. Três filtros, três testes, em
-- `apps/api/src/financeiro/venda-a-prazo.e2e.test.ts`. Venda a prazo não é
-- dinheiro que entrou na gaveta.
--
-- Não faz DML em tabela de negócio, então não declara ator.
-- ---------------------------------------------------------------------------

ALTER TABLE recebimentos DROP CONSTRAINT recebimentos_valor_check;

ALTER TABLE recebimentos
  ADD CONSTRAINT recebimento_valor_nao_negativo CHECK (valor >= 0);

ALTER TABLE recebimentos
  ADD CONSTRAINT recebimento_registra_algo CHECK (valor > 0 OR valor_aberto > 0);

-- ---------------------------------------------------------------------------
-- A FORMA, E A BICONDICIONAL.
--
-- `recebimentos_forma_check` da 0006 exigia uma das cinco formas, sempre.
-- Agora a lista vale quando houve dinheiro, e a string vazia vale — e é
-- obrigatória — quando não houve.
-- ---------------------------------------------------------------------------
ALTER TABLE recebimentos DROP CONSTRAINT recebimentos_forma_check;

ALTER TABLE recebimentos
  ADD CONSTRAINT recebimento_forma_valida CHECK (
    forma IN ('Pix','Dinheiro','Cartão de crédito','Cartão de débito','Nota promissória')
    OR forma = '');

ALTER TABLE recebimentos
  ADD CONSTRAINT recebimento_forma_so_com_dinheiro CHECK ((valor > 0) = (forma <> ''));

COMMENT ON COLUMN recebimentos.valor IS
  'Centavos do que a paciente PAGOU. Zero é a venda a prazo (D-9): o programa '
  'fechou e a dívida inteira está em valor_aberto. A linha de zero é invisível '
  'para o caixa do dia, a lista de recebimentos do dia e o LTV — ela é saldo, '
  'não receita.';

COMMENT ON COLUMN recebimentos.forma IS
  'Uma das cinco formas quando valor > 0; string VAZIA quando valor = 0. Não '
  'existe forma de pagamento para dinheiro que não se moveu.';

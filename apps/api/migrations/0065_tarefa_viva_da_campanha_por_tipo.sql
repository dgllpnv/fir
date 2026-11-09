-- ---------------------------------------------------------------------------
-- `tarefa_viva_da_campanha` PASSA A OLHAR O TIPO (correções da PO, A3 · N-6).
--
-- O índice da 0020 nasceu para a IMPORTAÇÃO: no máximo uma tarefa ABERTA por
-- (campanha, paciente), para que reimportar a mesma lista três vezes crie a
-- tarefa uma vez. Com a A3, a tarefa criada À MÃO também ganha campanha, e o
-- índice passa a recusar o fluxo mais comum da recepção: a importação criou a
-- "Ligação" aberta de P na campanha C, P aceita, e a recepção agenda a
-- "Consulta agendada" de P em C antes de concluir a ligação. Com o índice
-- antigo isso é 409, a recepção escolhe "Nenhuma", e a conversão e a receita
-- dessa consulta saem da campanha.
--
-- Duas mudanças, e nenhuma enfraquece a idempotência da importação:
--
--  1. **`tipo` entra na chave.** A importação usa UM tipo por lote; a mesma
--     lista com o mesmo tipo continua batendo no índice e caindo em
--     `ignoradas`. Ligação aberta + consulta agendada da mesma paciente na
--     mesma campanha passa.
--
--  2. **Tarefa de SÉRIE fica fora** (`serie_id IS NULL`). Uma série é N
--     ocorrências abertas do mesmo tipo, para a mesma paciente — com
--     campanha, a série inteira bateria no índice na criação (a segunda
--     ocorrência já é "duplicada"), e a edição que propaga a campanha para as
--     próximas (o protótipo faz, L1668) também. A importação nunca cria série,
--     então o caso que o índice protege continua inteiro dentro dele.
--
-- **O 23505 que sobrar vira 409 legível** num ponto só da API
-- (`FiltroDeTarefaVivaDaCampanha`), em todo caminho: criar, editar, reabrir,
-- a ação `reabrir` da jornada.
--
-- **Por que o DROP vem no mesmo arquivo, e não num release seguinte.** O
-- índice não guarda dado: removê-lo não destrói nada, e o novo é estritamente
-- MAIS permissivo que o velho (todo conjunto de linhas que o velho aceitava, o
-- novo aceita). Deixar os dois por um release manteria a recusa que este
-- ticket existe para tirar. O único custo é a janela do deploy: a importação
-- da versão ANTIGA nomeia o índice velho no `ON CONFLICT`, e falha se rodar
-- entre esta migration e a subida do código novo — a importação é ação rara
-- da gestora, e o erro é um 500 sem gravação (a transação inteira volta).
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX tarefa_viva_da_campanha_por_tipo
  ON tarefas (clinica_id, campanha_id, paciente_id, tipo)
  WHERE campanha_id IS NOT NULL
    AND paciente_id IS NOT NULL
    AND status = 'aberta'
    AND excluida_em IS NULL
    AND serie_id IS NULL;

DROP INDEX tarefa_viva_da_campanha;

-- O nome antigo continua sendo o que o código e o filtro de 409 procuram: um
-- índice novo com o nome de sempre, e não dois nomes para a mesma regra.
ALTER INDEX tarefa_viva_da_campanha_por_tipo RENAME TO tarefa_viva_da_campanha;

COMMENT ON INDEX tarefa_viva_da_campanha IS
  'No máximo UMA tarefa aberta, fora de série, por (campanha, paciente, tipo). '
  'É a idempotência da importação de campanha (0020) — com o tipo desde a 0065, '
  'para que a tarefa criada à mão (consulta agendada) conviva com a ligação '
  'importada da mesma paciente.';

-- ---------------------------------------------------------------------------
-- G8 1D — USO DA FIR CLINIC NA CARTEIRA: "faltas recontatadas" e o alerta R13.
--
-- PARTE 1 — `uso_diario_cliente.faltas_recontatadas` passa a distinguir
-- "ainda não calculado" de "zero recontatos".
--
-- A 0028 criou a coluna `NOT NULL DEFAULT 0` e o job G4 nunca a escreveu: as
-- linhas existentes têm `0` que NÃO quer dizer "ninguém foi recontatado" — o
-- próprio comentário da coluna dizia que esse 0 mentiria. Agora o job escreve
-- (decisão do dono, plano §9 itens 5/5b: reagendamento no dia D de um cartão
-- cuja etapa anterior era `faltou` ou `desmarcou`), e a tela precisa saber,
-- dia a dia, se o número existe (PP-8: até o job escrever, a tela oculta).
--
-- Expand/contract, compatível nos dois sentidos de deploy:
--   * código ANTIGO (job sem a coluna no INSERT) passa a gravar NULL — que é
--     exatamente "não calculado", e a tela oculta;
--   * código NOVO grava o número.
-- As linhas antigas viram NULL porque nunca foram calculadas; reprocessar um
-- dia (job com `diaAlvo`) preenche o número de verdade.
-- ---------------------------------------------------------------------------
ALTER TABLE uso_diario_cliente ALTER COLUMN faltas_recontatadas DROP DEFAULT;
ALTER TABLE uso_diario_cliente ALTER COLUMN faltas_recontatadas DROP NOT NULL;
UPDATE uso_diario_cliente SET faltas_recontatadas = NULL;

COMMENT ON COLUMN uso_diario_cliente.faltas_recontatadas IS
  'Cartões da jornada reagendados no dia (evento reagendar, no fuso da clínica) '
  'cuja etapa anterior era faltou ou desmarcou. NULL = o job ainda não '
  'calculou este dia; nunca confundir com 0.';

-- ---------------------------------------------------------------------------
-- PARTE 2 — R13: "FIR Clinic sem uso em X: ligar para a recepção".
--
-- Uma tarefa interna por cliente por dia, no máximo — chave EXPLÍCITA
-- `(cliente_carteira_id, alerta_de_uso_dia)` (regra 26). O índice cobre TODOS
-- os estados, inclusive `cancelada`: a equipe que cancelou o alerta do dia
-- não o vê renascer na próxima execução do job (regra 27 — nunca se recria o
-- que o usuário apagou). Os índices de marcador da 0032 excluem `cancelada`
-- de propósito (rotina) — por isso este é um índice próprio, não reuso.
-- ---------------------------------------------------------------------------
ALTER TABLE tarefas_internas ADD COLUMN alerta_de_uso_dia date;

COMMENT ON COLUMN tarefas_internas.alerta_de_uso_dia IS
  'Preenchido só nas tarefas criadas pelo alerta de uso baixo da FIR Clinic '
  '(R13): o dia (fuso da clínica) a que o alerta se refere. Chave de '
  'idempotência junto com cliente_carteira_id.';

CREATE UNIQUE INDEX tarefas_internas_alerta_de_uso
  ON tarefas_internas (cliente_carteira_id, alerta_de_uso_dia)
  WHERE alerta_de_uso_dia IS NOT NULL;

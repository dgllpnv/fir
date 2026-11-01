-- ---------------------------------------------------------------------------
-- AS CAMPANHAS — o épico 8.
--
-- *"Campanha com tipo, métrica e meta, importação de lista e funil do
-- período."* Uma campanha é um esforço com começo e fim (Outubro Rosa, a
-- semana de recaptação, a lista de aniversariantes do mês), e o que ela tem de
-- próprio é **uma meta com unidade declarada** e **as tarefas que nasceram
-- dela**.
--
-- Cinco decisões que esta migration fixa:
--
--  1. **NENHUM RESULTADO É GRAVADO** (regra 11). `resultado`, `pct`,
--     `taxaConv`, `receita`, `pacientes alcançados` e `convertidos` são
--     CONTAGENS derivadas de `tarefas` e `recebimentos`, calculadas no
--     servidor a cada leitura. É a mesma decisão da `0019`, e pela mesma
--     razão: um segundo número para a mesma pergunta é o que fica errado.
--
--  2. **A META É UM INTEIRO, E A ESCALA VEM DA MÉTRICA.** `convertidos`,
--     `contatos` e `tipo` são contagem; `receita` é **CENTAVOS** (regra 1).
--     Uma coluna só, com a escala declarada pela métrica — como
--     `metas_de_pessoa.alvo` e como `movimentos_de_estoque.quantidade`. Duas
--     colunas seriam duas representações do mesmo fato.
--
--     O protótipo guarda `meta: Number(c.meta)` em REAIS com ponto flutuante,
--     e `fmtRes` imprime `brl0(v)` — a meta de R$ 12.500,50 vira 12500.5 e
--     volta arredondada. Aqui ela é um `bigint` de centavos e não perde nada.
--
--  3. **`tipo_metrica` viaja com a métrica, ou não viaja.** `CHECK` em
--     bicondicional: *"Tipo de contato concluído"* sem dizer QUAL tipo é uma
--     meta que conta zero para sempre; um tipo guardado numa campanha de
--     receita é um campo que nenhuma tela mostra e que reaparece errado no dia
--     em que alguém trocar a métrica.
--
--  4. **EXCLUIR É SOFT DELETE, E A TAREFA CONTINUA LIGADA** (regra 20). Aqui
--     divergimos do protótipo, que apaga a campanha **e limpa o `campanhaId`
--     de toda tarefa dela** — o trabalho feito perde a atribuição para sempre,
--     e o painel do trimestre passado muda sozinho. Com soft delete, o nome
--     continua legível no histórico e a campanha some das escolhas.
--
--  5. **A IMPORTAÇÃO É IDEMPOTENTE POR ÍNDICE** (regra 26). O protótipo faz
--     `if (db.tasks.some(t => t.pacienteId===p.id && t.campanhaId===cp.id &&
--     t.status==="aberta")) ignoradas++`, que duas abas atravessam juntas. O
--     índice parcial abaixo transforma a mesma regra em esquema: reimportar a
--     mesma lista três vezes cria a tarefa UMA vez, e a segunda e a terceira
--     devolvem `ignoradas`.
-- ---------------------------------------------------------------------------

CREATE TABLE campanhas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES clinicas(id),

  -- Categoria e foco são os dois rótulos da tela dela ("Sazonal · Outubro
  -- Rosa"). Texto livre e não `enum`: é vocabulário da clínica, como o
  -- `Motivo de perda`, e cada clínica inventa o seu no segundo mês.
  categoria text NOT NULL DEFAULT 'Outra' CHECK (length(categoria) <= 60),
  foco      text NOT NULL DEFAULT ''      CHECK (length(foco) <= 80),

  nome     text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 80),
  objetivo text NOT NULL DEFAULT '' CHECK (length(objetivo) <= 400),

  -- Dia civil no fuso da clínica (regra 22), e a janela é FECHADA nas duas
  -- pontas aqui — `inicio <= hoje <= fim` é como a tela dela fala ("de 1 a 31
  -- de outubro"). A conversão para a janela semiaberta `[início, fim)` de
  -- instantes acontece na CONSULTA, onde há fuso para aplicar.
  inicio date NOT NULL,
  fim    date NOT NULL,

  -- As quatro de `METRICAS`, no protótipo.
  metrica text NOT NULL CHECK (metrica IN ('convertidos', 'contatos', 'tipo', 'receita')),
  -- O nome do tipo de tarefa, quando a métrica é `tipo`. Vazio nas outras.
  tipo_metrica text NOT NULL DEFAULT '' CHECK (length(tipo_metrica) <= 60),

  -- A META, inteiro, na escala da MÉTRICA (decisão 2). `bigint` porque
  -- `receita` é em centavos.
  meta bigint NOT NULL CHECK (meta > 0),

  excluida_em timestamptz,
  criada_em   timestamptz NOT NULL DEFAULT now(),
  criada_por  uuid REFERENCES pessoas(id),

  CONSTRAINT campanha_termina_depois_de_comecar CHECK (fim >= inicio),
  -- O TIPO VIAJA COM A MÉTRICA, OU NÃO VIAJA (decisão 3).
  CONSTRAINT tipo_combina_com_metrica
    CHECK ((metrica = 'tipo') = (btrim(tipo_metrica) <> '')),
  -- A chave composta que as tarefas e os pacientes referenciam: ela é o que
  -- impede uma tarefa de apontar para a campanha da clínica vizinha, mesmo
  -- com a RLS desligada por engano numa sessão de manutenção.
  CONSTRAINT campanhas_clinica_id_id_key UNIQUE (clinica_id, id)
);

/**
 * Nome único por clínica entre as VIVAS, pelo nome normalizado.
 *
 * Mesmo mecanismo de `unidades` e de `locais_de_estoque`: ler-depois-escrever
 * perde a corrida entre duas abas, e aí a clínica fica com duas "Outubro
 * Rosa" e o resultado da campanha partido em duas linhas do painel.
 *
 * Parcial em `excluida_em IS NULL`: a campanha removida por engano libera o
 * nome para voltar.
 */
CREATE UNIQUE INDEX campanha_por_nome
  ON campanhas (clinica_id, normalizar_nome(nome))
  WHERE excluida_em IS NULL;

CREATE INDEX campanhas_do_periodo ON campanhas (clinica_id, inicio, fim)
  WHERE excluida_em IS NULL;

COMMENT ON TABLE campanhas IS
  'Campanhas com meta e período. NÃO guarda resultado: `resultado`, `pct`, '
  '`receita` e a taxa de conversão são contagens derivadas de `tarefas` e '
  '`recebimentos` (regra 11).';

COMMENT ON COLUMN campanhas.meta IS
  'Inteiro na escala da MÉTRICA: contagem em `convertidos`, `contatos` e '
  '`tipo`; CENTAVOS em `receita` (regra 1).';

-- ---------------------------------------------------------------------------
-- O VÍNCULO: a tarefa e o paciente sabem de que campanha vieram.
--
-- As duas colunas entram por EXPAND — `NULL` é "não veio de campanha nenhuma",
-- que é o estado de toda linha que já existe. Nenhuma escrita antiga muda.
-- ---------------------------------------------------------------------------
ALTER TABLE tarefas ADD COLUMN campanha_id uuid;
ALTER TABLE tarefas ADD CONSTRAINT tarefa_e_da_campanha_da_clinica
  FOREIGN KEY (clinica_id, campanha_id) REFERENCES campanhas (clinica_id, id);

/**
 * O paciente que CHEGOU por uma campanha — é o `p.campanhaId` dela.
 *
 * Diferente do vínculo da tarefa: a tarefa diz *"esta ação é da campanha"*, o
 * paciente diz *"esta pessoa entrou na clínica por causa dela"*. Os dois
 * existem porque as perguntas são duas, e a segunda é a que mede se a campanha
 * trouxe gente nova.
 */
ALTER TABLE pacientes ADD COLUMN campanha_id uuid;
ALTER TABLE pacientes ADD CONSTRAINT paciente_e_da_campanha_da_clinica
  FOREIGN KEY (clinica_id, campanha_id) REFERENCES campanhas (clinica_id, id);

/**
 * **A IDEMPOTÊNCIA DA IMPORTAÇÃO, EM FORMA DE ÍNDICE** (decisão 5).
 *
 * No máximo UMA tarefa ABERTA por (campanha, paciente). É literalmente a
 * condição que o protótipo confere com `some()` antes de empurrar a linha, e
 * que duas abas atravessam juntas.
 *
 * **Só as ABERTAS**: a campanha que terminou e foi concluída pode receber uma
 * segunda ação do mesmo paciente mais tarde — é o caso real da recaptação que
 * volta. O que se impede é a MESMA pendência duas vezes, que é o que a
 * reimportação do mesmo arquivo cria.
 */
CREATE UNIQUE INDEX tarefa_viva_da_campanha
  ON tarefas (clinica_id, campanha_id, paciente_id)
  WHERE campanha_id IS NOT NULL
    AND paciente_id IS NOT NULL
    AND status = 'aberta'
    AND excluida_em IS NULL;

CREATE INDEX tarefas_da_campanha ON tarefas (clinica_id, campanha_id)
  WHERE campanha_id IS NOT NULL AND excluida_em IS NULL;

CREATE INDEX pacientes_da_campanha ON pacientes (clinica_id, campanha_id)
  WHERE campanha_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RLS + TRILHA.
--
-- `ENABLE` mais `FORCE` para que nem o dono escape. A policy filtra por
-- clínica com AND e nada mais; o trigger de auditoria é obrigatório em toda
-- relação com `clinica_id` (`teste/auditoria-inescapavel.test.ts`).
-- ---------------------------------------------------------------------------
ALTER TABLE campanhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE campanhas FORCE  ROW LEVEL SECURITY;
CREATE POLICY campanhas_por_clinica ON campanhas
  USING (clinica_id = app_clinica_id())
  WITH CHECK (clinica_id = app_clinica_id());
CREATE TRIGGER campanhas_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON campanhas
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();
GRANT SELECT, INSERT, UPDATE, DELETE ON campanhas TO fir_app;

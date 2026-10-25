-- ---------------------------------------------------------------------------
-- ÉPICO 3 — A JORNADA DO PACIENTE, amarrada no banco.
--
-- As colunas `etapa` (`etapa_de_jornada`) e `historico` (`jsonb`) já nasceram
-- na 0006, com os nove valores do ENUM — inclusive `encerrado`, reservado por
-- este épico. Esta migration acrescenta o que falta e, sobretudo, escreve o
-- `CHECK` que torna o estado impossível impossível.
--
-- Ela faz DML em tabela de negócio (semeia motivos, conserta etapa, reescreve
-- o histórico), então declara o ATOR: a trigger `registrar_auditoria` da 0004
-- recusa escrita sem ele, e a recusa é o comportamento certo. `true` =
-- escopo de transação, e `migrar.ts` envolve cada arquivo numa.
-- ---------------------------------------------------------------------------
SELECT set_config('app.pessoa_id', 'sistema', true);

-- ---------------------------------------------------------------------------
-- MOTIVOS DE PERDA — dado da clínica, não ENUM do código (decisão D-1).
--
-- A lista É o relatório: "Orçamentos perdidos: 4 · veja os motivos no
-- histórico" só vira gestão quando a clínica pode acrescentar o motivo que
-- ela de fato ouve ao telefone — "esperando o marido decidir", "foi para o
-- convênio". Um ENUM do Postgres exigiria uma migration por motivo novo, e as
-- 4 clínicas têm vocabulários diferentes.
-- ---------------------------------------------------------------------------
CREATE TABLE motivos_de_perda (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id    uuid NOT NULL REFERENCES clinicas(id),
  nome          text NOT NULL CHECK (length(nome) BETWEEN 1 AND 60),
  -- `normalizar_nome` é da 0006. Reusada de propósito: duas normalizações de
  -- nome no mesmo banco é como "Preço" e "preço" viram dois motivos e o
  -- relatório do trimestre reporta a mesma perda em duas linhas.
  nome_chave    text GENERATED ALWAYS AS (normalizar_nome(nome)) STORED,
  ordem         smallint NOT NULL DEFAULT 0,
  -- Desativar é um ESTADO, nunca uma exclusão (regra 20): o evento de perda
  -- guarda o `motivo_id`, e apagar a linha deixaria o relatório do trimestre
  -- passado apontando para o vazio.
  ativo         boolean NOT NULL DEFAULT true,
  desativado_em timestamptz,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT desativado_tem_instante CHECK ((NOT ativo) = (desativado_em IS NOT NULL)),
  -- ALVO DA CHAVE ESTRANGEIRA COMPOSTA, abaixo. Não é redundante com a PK:
  -- uma FK só pode apontar para colunas cobertas por uma CONSTRAINT única, e
  -- é este par que impede o motivo da clínica vizinha de colar numa tarefa.
  CONSTRAINT motivos_id_clinica UNIQUE (id, clinica_id)
);

CREATE UNIQUE INDEX motivos_nome_unico ON motivos_de_perda (clinica_id, nome_chave) WHERE ativo;
CREATE INDEX motivos_da_clinica ON motivos_de_perda (clinica_id, ordem, nome) WHERE ativo;

COMMENT ON TABLE motivos_de_perda IS
  'O vocabulário de perda DA CLÍNICA. O evento de perda guarda o id E o nome '
  'no instante do evento (decisão D-2): renomear não reescreve a história.';

-- ---------------------------------------------------------------------------
-- A SEMEADURA, ONDE NENHUM CAMINHO ESCAPA.
--
-- Divergência consciente do plano, que manda semear "no fluxo de criação de
-- clínica, onde `perfisPadrao()` já é escrito". Esse fluxo é hoje UM script
-- (`semear.ts`): não existe rota que crie clínica, e os testes criam clínica
-- por `INSERT` cru. Semear em TypeScript deixaria toda clínica nascida por
-- qualquer outro caminho — fixture, migração das 4 clínicas, o épico 12 — com
-- a lista vazia. E lista vazia, com `perder` exigindo motivo, é um cartão que
-- não consegue ser perdido.
--
-- Os cinco nomes e a ordem vêm de `MOTIVOS_PERDA` do protótipo. Não invente
-- outros: a clínica acrescenta os dela.
-- ---------------------------------------------------------------------------
CREATE FUNCTION motivos_de_perda_padrao() RETURNS TABLE (nome text, ordem smallint)
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT * FROM (VALUES
      ('Preço',                  1::smallint),
      ('Sem retorno do paciente', 2::smallint),
      ('Escolheu outro lugar',    3::smallint),
      ('Não é o momento',         4::smallint),
      ('Outro',                   5::smallint)) AS m(nome, ordem)
  $$;

CREATE FUNCTION semear_motivos_de_perda() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  -- `SECURITY DEFINER`: roda como `fir_migrate`, que tem BYPASSRLS. Sem isso,
  -- uma clínica criada por `fir_app` (o épico 12) teria a semeadura recusada
  -- pela policy, porque `app.clinica_id` ainda não é a clínica recém-criada.
  INSERT INTO public.motivos_de_perda (clinica_id, nome, ordem)
  SELECT NEW.id, m.nome, m.ordem FROM public.motivos_de_perda_padrao() m;
  RETURN NULL;
END $$;

CREATE TRIGGER clinicas_semeia_motivos AFTER INSERT ON clinicas
  FOR EACH ROW EXECUTE FUNCTION semear_motivos_de_perda();

-- E as clínicas que JÁ EXISTEM — inclusive as 4 que vão ser migradas, se a
-- clínica já tiver sido criada quando esta migration rodar.
INSERT INTO motivos_de_perda (clinica_id, nome, ordem)
SELECT c.id, m.nome, m.ordem FROM clinicas c, motivos_de_perda_padrao() m;

-- ---------------------------------------------------------------------------
-- AS COLUNAS DA JORNADA
-- ---------------------------------------------------------------------------
ALTER TABLE tarefas
  -- Centavos. E NÃO É RECEITA (regra 4): nunca entra em total recebido, em
  -- LTV nem em meta. Fica aqui, e não em `recebimentos`, exatamente porque
  -- `recebimentos` é a tabela do dinheiro que ENTROU. Nota promissória não
  -- entra no caixa, e orçamento não é nem promissória — é proposta.
  ADD COLUMN valor_orcamento  bigint CHECK (valor_orcamento IS NULL OR valor_orcamento > 0),
  -- A proposta de programa, guardada INTEIRA para o épico 5 consumir no
  -- fechamento. Máx. 10 itens, validados contra o catálogo no serviço.
  -- Dinheiro aqui dentro é STRING DE CENTAVOS (decisão D-4).
  ADD COLUMN programa_orcado  jsonb,
  ADD COLUMN motivo_perda_id  uuid,
  -- O DIA A PARTIR DO QUAL ESTE CARTÃO VOLTA A PEDIR AÇÃO (decisão D-3).
  -- Substitui o `acaoEm` do protótipo, que tinha DOIS significados (dia do
  -- no-show e dia de retomar o orçamento). Recontatar e "orçamentos para
  -- retomar" passam a ser a MESMA cláusula `proximo_passo_em <= hoje`.
  ADD COLUMN proximo_passo_em date,
  -- O épico 10 manda a mensagem; aqui fica só o registro de que foi mandada.
  ADD COLUMN confirmacao_enviada_em timestamptz;

COMMENT ON COLUMN tarefas.valor_orcamento IS
  'Centavos do negócio proposto. NÃO É RECEITA (regra 4): mede conversão, e '
  'nada mais. Receita é `recebimentos.valor`.';
COMMENT ON COLUMN tarefas.proximo_passo_em IS
  'O dia a partir do qual este cartão volta a pedir ação. Um significado só.';

-- ---------------------------------------------------------------------------
-- A CHAVE ESTRANGEIRA COMPOSTA — e por que não a simples.
--
-- `motivo_perda_id uuid REFERENCES motivos_de_perda(id)` compila, aplica e
-- ACEITA o motivo da clínica vizinha: a verificação de FK roda pelo sistema e
-- ATRAVESSA A RLS. Foi exatamente assim que a unidade de outra clínica colou
-- num paciente no épico 2 (commit d0d4bb0), descoberto por medição e não por
-- revisão.
--
-- Com `(motivo_perda_id, clinica_id)`, o banco recusa. `MATCH SIMPLE` (o
-- padrão) satisfaz a restrição quando QUALQUER coluna referenciando é NULL, e
-- `tarefas.clinica_id` é `NOT NULL` — então um cartão sem motivo passa, e um
-- cartão com motivo é obrigado a usar o vocabulário da própria clínica.
-- ---------------------------------------------------------------------------
ALTER TABLE tarefas ADD CONSTRAINT tarefas_motivo_da_clinica
  FOREIGN KEY (motivo_perda_id, clinica_id)
  REFERENCES motivos_de_perda (id, clinica_id);

-- ---------------------------------------------------------------------------
-- O HISTÓRICO, REESCRITO PARA AS CHAVES POR EXTENSO (decisão D-5).
--
-- O épico 2 grava `{e, em, por, nota}` — as abreviações do protótipo. A
-- decisão D-5 é `{acao, etapa, em, porId, nota, valor, motivoId, motivo}`:
-- nome no código = nome no glossário = nome na tela. E o custo de migração é
-- zero NA V20, que não tem histórico nenhum — mas NÃO é zero nesta árvore,
-- porque o épico 2 já escreveu a forma curta no banco local.
--
-- Duas formas de evento no mesmo `jsonb` seria o pior dos mundos: o funil
-- (`ev->>'acao'`) contaria metade dos eventos, em silêncio, e a metade que
-- some é justamente a mais antiga — a que ninguém reconfere.
--
-- `e` guardava a ETAPA; a AÇÃO que a produziu é inferida, e só há duas no
-- épico 2: `agendado` nasceu de `agendar`, `realizado` de `concluir`.
-- ---------------------------------------------------------------------------
UPDATE tarefas t
   SET historico = (
         SELECT coalesce(
                  jsonb_agg(
                    jsonb_strip_nulls(jsonb_build_object(
                      'acao',  CASE ev ->> 'e'
                                 WHEN 'agendado'  THEN 'agendar'
                                 WHEN 'realizado' THEN 'concluir'
                                 ELSE ev ->> 'e' END,
                      'etapa', ev ->> 'e',
                      'em',    ev ->> 'em',
                      -- `por` nunca foi nulo no épico 2; o coalesce existe
                      -- para que `porId` seja sempre presente, como o tipo diz.
                      'porId', coalesce(ev ->> 'por', t.solicitante_id::text),
                      'nota',  ev ->> 'nota'))
                    ORDER BY ord),
                  '[]'::jsonb)
           FROM jsonb_array_elements(t.historico) WITH ORDINALITY AS x(ev, ord)
       )
 WHERE jsonb_array_length(t.historico) > 0
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.historico) ev WHERE ev ? 'e');

-- ---------------------------------------------------------------------------
-- O DADO EXISTENTE, ANTES DOS `CHECK`.
--
-- Uma restrição só é aplicável se o dado já a satisfaz, e o épico 2 gravou
-- combinações que a partir de agora são impossíveis:
--
--   `cancelar` grava `status='cancelada'` SEM tocar em `etapa` — o cartão
--   fica `agendado`/`cancelada`, que é o estado que o protótipo também
--   produz e que faz "onde está este cartão?" exigir DUAS colunas.
--
-- Cada conserto é também o que `etapaDerivada` (packages/domain) faria, e é
-- de propósito: a função existe para o épico 9 preencher etapa de dado
-- migrado, e aqui ela está sendo aplicada ao dado migrado do épico 2.
-- ---------------------------------------------------------------------------

-- Cancelada com etapa da jornada → `encerrado`, com o evento no histórico.
UPDATE tarefas
   SET etapa = 'encerrado',
       historico = historico || jsonb_build_array(jsonb_build_object(
         'acao',  'encerrar',
         'etapa', 'encerrado',
         'em',    to_char(coalesce(concluida_em, criada_em) AT TIME ZONE 'UTC',
                          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'porId', solicitante_id::text,
         'nota',  'etapa preenchida pela migration 0007'))
 WHERE etapa IS NOT NULL AND status = 'cancelada' AND etapa <> 'encerrado';

-- Concluída com etapa em aberto → `realizado`. (Caminho morto hoje: `concluir`
-- já move a etapa. Barato, e falha para o lado certo.)
UPDATE tarefas SET etapa = 'realizado'
 WHERE status = 'concluida' AND etapa IN ('agendado','confirmado','faltou','desmarcou');

-- Aberta com etapa de concluída/cancelada → volta para `agendado`.
UPDATE tarefas SET etapa = 'agendado'
 WHERE status = 'aberta' AND etapa IN ('realizado','orcamento','fechado','perdido','encerrado');

-- Etapa sem paciente → sem etapa. A jornada é DO PACIENTE.
UPDATE tarefas SET etapa = NULL WHERE etapa IS NOT NULL AND paciente_id IS NULL;

-- ---------------------------------------------------------------------------
-- O CHECK QUE TORNA O ESTADO IMPOSSÍVEL IMPOSSÍVEL.
--
-- `faltou` e `desmarcou` com `status='aberta'` é O INVARIANTE DO ÉPICO: é o
-- que faz o cartão aparecer em "Recontatar" todo dia até alguém reagendar ou
-- encerrar. Escrito aqui, nenhum caminho futuro — job, importação, migração
-- das 4 clínicas, correção manual no psql — consegue gravar um cartão num
-- estado que a tela não sabe mostrar.
--
-- Este é o invariante que, quebrado, NÃO PRODUZ ERRO NENHUM: produz silêncio,
-- e ninguém liga para quem faltou. É precisamente a classe de defeito que
-- pertence ao banco, e não à revisão de código.
--
-- A mesma tabela vive em `packages/domain/src/jornada.ts` (`STATUS_DA_ETAPA`),
-- e uma propriedade de teste confere que as duas declarações concordam.
-- ---------------------------------------------------------------------------
ALTER TABLE tarefas ADD CONSTRAINT etapa_combina_com_status CHECK (
  etapa IS NULL OR (
    (etapa IN ('agendado','confirmado','faltou','desmarcou') AND status = 'aberta')    OR
    (etapa IN ('realizado','orcamento','fechado','perdido')  AND status = 'concluida') OR
    (etapa = 'encerrado'                                     AND status = 'cancelada')
  ));

ALTER TABLE tarefas ADD CONSTRAINT etapa_exige_paciente CHECK (
  etapa IS NULL OR paciente_id IS NOT NULL);

ALTER TABLE tarefas ADD CONSTRAINT orcamento_so_com_etapa CHECK (
  (valor_orcamento IS NULL AND programa_orcado IS NULL)
  OR etapa IN ('orcamento','fechado','perdido'));

ALTER TABLE tarefas ADD CONSTRAINT motivo_so_em_perdido CHECK (
  motivo_perda_id IS NULL OR etapa = 'perdido');

-- ---------------------------------------------------------------------------
-- ÍNDICES — as três consultas que a tela Hoje faz a cada abertura.
--
-- Parciais, porque a fração da tabela que interessa é minúscula e cresce com
-- o que está PENDENTE, não com o histórico da clínica.
-- ---------------------------------------------------------------------------
CREATE INDEX tarefas_em_recontato ON tarefas (clinica_id, proximo_passo_em)
  WHERE etapa IN ('faltou','desmarcou') AND excluida_em IS NULL;

CREATE INDEX tarefas_para_retomar ON tarefas (clinica_id, proximo_passo_em)
  WHERE etapa = 'orcamento' AND excluida_em IS NULL;

CREATE INDEX tarefas_por_etapa ON tarefas (clinica_id, etapa, prazo)
  WHERE etapa IS NOT NULL AND excluida_em IS NULL;

-- ---------------------------------------------------------------------------
-- O ÍNDICE DO FUNIL, e o que ele NÃO serve.
--
-- O funil (épico 3, Task 9) percorre os eventos com `jsonb_array_elements`
-- numa `LATERAL`, e isso é um varredura do array — nenhum índice GIN a
-- acelera. O que este índice serve é CONTENÇÃO (`historico @> '[{...}]'`), e
-- é a forma que um "quem teve evento X no período" pode tomar se o `LATERAL`
-- não segurar.
--
-- Está aqui porque o plano o pede e porque a Task 9 mede com 50 mil tarefas:
-- se o `EXPLAIN ANALYZE` não o usar, a decisão certa é DERRUBÁ-LO numa 0008 —
-- índice que nenhuma consulta usa é imposto cobrado em toda escrita da tabela
-- mais quente do sistema.
-- ---------------------------------------------------------------------------
CREATE INDEX tarefas_historico ON tarefas USING gin (historico jsonb_path_ops)
  WHERE etapa IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RLS e trilha na tabela nova (regras 19 e 20).
-- ---------------------------------------------------------------------------
ALTER TABLE motivos_de_perda ENABLE ROW LEVEL SECURITY;
ALTER TABLE motivos_de_perda FORCE  ROW LEVEL SECURITY;
CREATE POLICY motivos_por_clinica ON motivos_de_perda
  USING (clinica_id = app_clinica_id()) WITH CHECK (clinica_id = app_clinica_id());

CREATE TRIGGER motivos_de_perda_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON motivos_de_perda
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

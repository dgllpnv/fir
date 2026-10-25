-- ---------------------------------------------------------------------------
-- O FINANCEIRO: contas a pagar, caixa do dia, cobranças, meta e configuração.
--
-- O número: o plano anunciava `0007`, que a jornada tomou enquanto ele era
-- escrito. `0009` é o próximo livre (`0005` está reservada ao plano de
-- administração, que ainda não entrou). Migration aplicada nunca se edita.
--
-- A decisão que atravessa o arquivo inteiro: NENHUMA coluna de dinheiro nasce
-- em `tarefas`, e nenhuma linha nova de receita nasce fora de `recebimentos`.
-- O recebimento avulso do épico 4 cria a TAREFA COMPANHEIRA concluída e
-- pendura o recebimento nela — a mesma tabela da `0006`, com o mesmo índice
-- único que torna impossível contar o mesmo pagamento duas vezes.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- CONTAS A PAGAR
--
-- `recorrente boolean` do protótipo não existe aqui: a recorrência É a série.
-- Duas representações do mesmo fato (um booleano e um vínculo) divergem no
-- dia em que alguém desmarca uma e não a outra.
-- ---------------------------------------------------------------------------
CREATE TABLE contas_a_pagar (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id      uuid NOT NULL REFERENCES clinicas(id),
  descricao       text NOT NULL CHECK (length(descricao) BETWEEN 1 AND 80),
  -- `text` e não ENUM: acrescentar uma categoria para uma clínica não pode
  -- exigir migration. A lista válida é a de `packages/domain` e a borda Zod
  -- a cobra; aqui fica só o tamanho. Um nome fora da lista que chegue por
  -- migração de dado é somado em `Outras despesas` pela Visão do mês — nunca
  -- descartado, que é como uma categoria some do total sem erro nenhum.
  categoria       text NOT NULL CHECK (length(categoria) <= 40),
  valor           bigint NOT NULL CHECK (valor > 0),
  -- `date`: vencimento é um dia no CALENDÁRIO da clínica, nunca um instante.
  vencimento      date NOT NULL,
  fornecedor      text NOT NULL DEFAULT '' CHECK (length(fornecedor) <= 80),
  responsavel_id  uuid NOT NULL REFERENCES pessoas(id),
  unidade_id      uuid REFERENCES unidades(id),

  -- A SÉRIE MENSAL, e a ÂNCORA.
  --
  -- `dia_vencimento` (1–31) é o dia ORIGINAL, e é ele que faz 31/12 → 31/01
  -- → 28/02 → 31/03. Sem a âncora — que é o que o protótipo faz — a conta
  -- cai para o dia 28 em fevereiro e NUNCA MAIS volta: medido.
  serie_id        uuid,
  dia_vencimento  smallint CHECK (dia_vencimento BETWEEN 1 AND 31),
  CONSTRAINT serie_tem_ancora CHECK ((serie_id IS NULL) = (dia_vencimento IS NULL)),

  pago_em         date,
  valor_pago      bigint CHECK (valor_pago > 0),
  forma_pagamento text NOT NULL DEFAULT '' CHECK (length(forma_pagamento) <= 30),
  pago_por        uuid REFERENCES pessoas(id),
  CONSTRAINT pagamento_completo CHECK (
    (pago_em IS NULL) = (valor_pago IS NULL) AND (pago_em IS NULL) = (pago_por IS NULL)),

  excluida_em     timestamptz,
  criada_em       timestamptz NOT NULL DEFAULT now(),
  criada_por      uuid REFERENCES pessoas(id)
);

COMMENT ON COLUMN contas_a_pagar.dia_vencimento IS
  'A ÂNCORA da série: o dia ORIGINAL (1-31). É ela que faz 31/12 -> 31/01 -> '
  '28/02 -> 31/03. Sem ela a conta cai no dia 28 em fevereiro e nunca volta.';

COMMENT ON COLUMN contas_a_pagar.valor_pago IS
  'O que de fato saiu. Pode diferir de `valor` — a conta era 980 e veio 1012 — '
  'e é ESTE que entra no resultado do mês.';

-- A CONTA DO MÊS SEGUINTE NASCE UMA VEZ.
-- Não é `if (!F.contas.some(y => y.descricao===c.descricao && …))` no serviço:
-- a chave por descrição quebra assim que alguém renomeia a conta, e o `if`
-- perde a corrida entre duas abas. É o banco que recusa.
CREATE UNIQUE INDEX conta_da_serie_por_mes ON contas_a_pagar (clinica_id, serie_id, vencimento)
  WHERE serie_id IS NOT NULL AND excluida_em IS NULL;

CREATE INDEX contas_abertas ON contas_a_pagar (clinica_id, vencimento)
  WHERE pago_em IS NULL AND excluida_em IS NULL;
CREATE INDEX contas_pagas_por_mes ON contas_a_pagar (clinica_id, pago_em)
  WHERE pago_em IS NOT NULL AND excluida_em IS NULL;
CREATE INDEX contas_por_responsavel ON contas_a_pagar (clinica_id, responsavel_id, vencimento)
  WHERE excluida_em IS NULL;

-- ---------------------------------------------------------------------------
-- CAIXA DO DIA — e por que são DUAS tabelas
--
-- O esperado e o contado por forma poderiam ser um `jsonb`. Não são, por dois
-- motivos: `bigint` não cabe em número JSON sem perda acima de 2^53 (e
-- guardá-lo como texto dentro do jsonb torna a Visão do mês incapaz de somar
-- em SQL), e a diferença por forma é exatamente o que a clínica lê.
--
-- NÃO existe coluna `diferenca`. Ela é `Σ(contado − esperado)` sobre as
-- linhas, e as linhas são FATOS CONGELADOS do fechamento. Uma coluna
-- redundante é uma coluna que um dia discorda da soma.
-- ---------------------------------------------------------------------------
CREATE TABLE caixas_do_dia (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id   uuid NOT NULL REFERENCES clinicas(id),
  dia          date NOT NULL,
  obs          text NOT NULL DEFAULT '' CHECK (length(obs) <= 160),
  fechado_por  uuid NOT NULL REFERENCES pessoas(id),
  fechado_em   timestamptz NOT NULL DEFAULT now()
);

-- UM FECHAMENTO POR DIA. O segundo é recusado pelo banco, não por um `some()`.
CREATE UNIQUE INDEX caixa_por_dia ON caixas_do_dia (clinica_id, dia);

--
-- `id` de uma coluna só, e a chave natural como índice ÚNICO ao lado. Não é
-- gosto: o `registrar_auditoria` grava `NEW.id` em `auditoria.entidade_id`,
-- que é `NOT NULL`, então uma chave composta faria TODA escrita nesta tabela
-- falhar em produção — e, se passasse, a trilha apontaria para um registro
-- que ninguém encontra. `teste/auditoria-inescapavel.test.ts` varre o
-- catálogo e cobra exatamente isso; foi ele que pegou as três tabelas que
-- este arquivo trazia com chave composta.
CREATE TABLE caixa_por_forma (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caixa_id    uuid NOT NULL REFERENCES caixas_do_dia(id),
  clinica_id  uuid NOT NULL REFERENCES clinicas(id),
  -- As QUATRO da gaveta, e só elas. `Nota promissória` continua sendo receita
  -- e entra no LTV; ela só não está na gaveta, e um campo que a conferência
  -- ignora é um campo que alguém soma um dia.
  forma       text NOT NULL CHECK (forma IN ('Pix','Dinheiro','Cartão de crédito','Cartão de débito')),
  -- O esperado NO MOMENTO DO FECHAMENTO. Fato do evento, não valor derivado:
  -- um recebimento lançado depois, retroativo, mudaria o número e a
  -- conferência deixaria de dizer o que era verdade quando se contou.
  esperado    bigint NOT NULL,
  contado     bigint NOT NULL
);

-- Uma linha por forma em cada caixa. As quatro nascem juntas no fechamento.
CREATE UNIQUE INDEX caixa_por_forma_unica ON caixa_por_forma (caixa_id, forma);

-- ---------------------------------------------------------------------------
-- COBRANÇAS — um log de contato, append-only. Não tem soft delete porque não
-- tem exclusão: "a clínica falou com a paciente no dia 12" não se desfaz.
-- ---------------------------------------------------------------------------
CREATE TABLE cobrancas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id   uuid NOT NULL REFERENCES clinicas(id),
  paciente_id  uuid NOT NULL REFERENCES pacientes(id),
  canal        text NOT NULL CHECK (canal IN ('WhatsApp','Telefone','Presencial','Outro')),
  em           timestamptz NOT NULL DEFAULT now(),
  por          uuid NOT NULL REFERENCES pessoas(id)
);
CREATE INDEX cobrancas_por_paciente ON cobrancas (clinica_id, paciente_id, em DESC);

-- ---------------------------------------------------------------------------
-- META DO MÊS — `date` no dia 1, não `text 'aaaa-mm'`: ordenação, janela e
-- aritmética de mês saem de graça, e um mês inválido não entra.
--
-- Meta zero não existe como linha: `PUT` com zero REMOVE a meta, em vez de
-- gravar um denominador que não tem percentual.
-- ---------------------------------------------------------------------------
CREATE TABLE metas_do_mes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id    uuid NOT NULL REFERENCES clinicas(id),
  competencia   date NOT NULL CHECK (extract(day FROM competencia) = 1),
  valor         bigint NOT NULL CHECK (valor > 0),
  definida_por  uuid NOT NULL REFERENCES pessoas(id),
  definida_em   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX meta_por_competencia ON metas_do_mes (clinica_id, competencia);

CREATE TABLE configuracao_financeira (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id            uuid NOT NULL REFERENCES clinicas(id),
  -- Por padrão a RECEPÇÃO, que não tem `valores`. É esta escolha que faz a
  -- conferência às cegas ser cega de ponta a ponta para quem conta a gaveta;
  -- apontá-la para o Financeiro transforma o ritual em teatro, e por isso ela
  -- é explícita e auditável em vez de acidental.
  caixa_responsavel_id  uuid REFERENCES pessoas(id),
  mensagem_de_cobranca  text NOT NULL DEFAULT '' CHECK (length(mensagem_de_cobranca) <= 400),
  atualizada_em         timestamptz NOT NULL DEFAULT now()
);

-- Uma configuração por clínica. O `UNIQUE` faz o papel que a chave primária
-- fazia antes de `id` existir; ver a nota em `caixa_por_forma`.
CREATE UNIQUE INDEX configuracao_por_clinica ON configuracao_financeira (clinica_id);

-- ---------------------------------------------------------------------------
-- O que falta nas tabelas da 0006. Expand, sem tocar no que já existe.
-- ---------------------------------------------------------------------------

-- IDEMPOTÊNCIA DO RECEBIMENTO.
-- A tela desabilita o botão ao enviar; isso é front. Numa conexão de balcão
-- lenta, o duplo toque chega duas vezes ao servidor, e a regra 3 não protege
-- deste caso: são duas tarefas companheiras diferentes, cada uma com UM
-- recebimento. O índice abaixo é o que faz o reenvio devolver o MESMO
-- recebimento em vez de criar o segundo.
--
-- Parcial (`WHERE requisicao_id IS NOT NULL`) porque o pagamento embutido do
-- épico 2 não tem requisição, e dois pagamentos legítimos não podem colidir.
--
-- MEDIDO: tirar o `WHERE` não quebra nenhum teste hoje — no Postgres, NULLs
-- não colidem num índice único comum. A cláusula não está aqui por causa do
-- comportamento de hoje, e sim porque `NULLS NOT DISTINCT` (PG 15) mudaria
-- esse comportamento em silêncio num `REINDEX` futuro, e porque a intenção
-- precisa estar escrita. É a mesma razão do `tarefa_id IS NOT NULL` na 0006.
ALTER TABLE recebimentos ADD COLUMN requisicao_id uuid;
CREATE UNIQUE INDEX recebimento_por_requisicao ON recebimentos (clinica_id, requisicao_id)
  WHERE requisicao_id IS NOT NULL;

COMMENT ON COLUMN recebimentos.requisicao_id IS
  'Gerado pelo CLIENTE ao ABRIR o formulário, nunca ao enviar. Gerado no '
  'envio, o duplo toque produz dois ids e o índice não serve para nada.';

-- MARCADOR DE ROTINA: liga a tarefa à rotina que a criou ("fechamento-do-mes").
-- Com `prazo` na chave, criar a rotina duas vezes gera o MESMO conjunto de
-- (marcador, prazo) e o segundo `INSERT … ON CONFLICT DO NOTHING` não escreve
-- nada. Idempotência sem lock.
ALTER TABLE tarefas ADD COLUMN marcador text CHECK (length(marcador) <= 40);
CREATE UNIQUE INDEX tarefa_de_rotina ON tarefas (clinica_id, marcador, prazo)
  WHERE marcador IS NOT NULL AND excluida_em IS NULL;

-- ---------------------------------------------------------------------------
-- RLS e trilha, nas seis.
--
-- `ENABLE` mais `FORCE`: sem o `FORCE`, o dono da tabela escapa da política e
-- um papel que venha a ser dono enxerga todas as clínicas.
-- ---------------------------------------------------------------------------
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['contas_a_pagar','caixas_do_dia','caixa_por_forma',
                           'cobrancas','metas_do_mes','configuracao_financeira'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I_por_clinica ON %I USING (clinica_id = app_clinica_id()) '
      'WITH CHECK (clinica_id = app_clinica_id())', t, t);
    EXECUTE format(
      'CREATE TRIGGER %I_auditoria AFTER INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION registrar_auditoria()', t, t);
  END LOOP;
END $$;

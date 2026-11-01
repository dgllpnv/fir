-- ---------------------------------------------------------------------------
-- O ESTOQUE: locais, itens com as três unidades, e o movimento APPEND-ONLY.
--
-- As decisões que esta migration fixa, e que o épico inteiro depende delas:
--
--  1. **AS CONVERSÕES SÃO COLUNAS DO ITEM, nunca número em código** (regra 9).
--     `1 unid_compra = fator_compra × medida` e `1 medida = fator_uso × unid_uso`.
--     No dia em que o fornecedor mudar a caixa de 4 para 6 ampolas, muda o
--     cadastro e o código não é tocado.
--
--  2. **TODO MOVIMENTO É EM `medida`, em milésimos, `bigint`** (regra 8). A nota
--     chega em caixas e a dose em mg; as duas são convertidas na BORDA, pelo
--     `paraMedida` de `packages/domain`, e o que se grava é sempre a unidade de
--     estoque. Uma coluna `unidade` por movimento seria a segunda
--     representação do mesmo número, e a soma de saldo passaria a depender de
--     qual delas cada linha escolheu.
--
--  3. **SALDO NÃO É COLUNA** (regra 11). Ele é `última contagem + entradas −
--     saídas ± ajustes`, derivado em `saldoEmMedida`. Um `itens.saldo` gravado
--     seria um segundo número para a mesma pergunta — e o segundo é o que fica
--     errado.
--
--  4. **MOVIMENTO É APPEND-ONLY** (regra 12), e desfazer é um movimento
--     COMPENSATÓRIO que aponta para a origem. `UNIQUE (compensa_id)` é o que
--     torna `desfazer` idempotente **no esquema**: reabrir a sessão duas vezes
--     não devolve a dose duas vezes, e isso não depende de um `if` no serviço
--     que perde a corrida entre duas abas.
--
--  5. **O SINAL VEM DO TIPO.** `milesimos` é assinado, com `CHECK` amarrando o
--     sinal ao tipo. O protótipo guarda `qtd` positiva mais uma coluna `sinal`
--     usada só pelo ajuste, e deriva o resto de um `if` encadeado (`sinalMov`)
--     — três lugares para a mesma pergunta.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- LOCAIS DE ESTOQUE
--
-- "Onde o item fica na clínica": sala de estoque, geladeira, sala da doutora.
-- A lista de contagem sai agrupada por local, como um roteiro (MANUAL cap. 12).
-- ---------------------------------------------------------------------------
CREATE TABLE locais_de_estoque (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id  uuid NOT NULL REFERENCES clinicas(id),
  nome        text NOT NULL CHECK (length(nome) BETWEEN 1 AND 40),
  nome_chave  text GENERATED ALWAYS AS (normalizar_nome(nome)) STORED,
  -- Um local pertence a uma unidade de atendimento, ou a nenhuma (clínica com
  -- um endereço só).
  unidade_id  uuid REFERENCES unidades(id),
  ativo       boolean NOT NULL DEFAULT true,
  excluido_em timestamptz,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  criado_por  uuid REFERENCES pessoas(id)
);

-- `NULLS NOT DISTINCT` (Postgres 15+), e é o ponto: o protótipo compara
-- `(l.unidadeId||"") === (x.unidadeId||"")`, ou seja, "sem unidade" é UM balde
-- que deduplica. Com o padrão `NULLS DISTINCT`, duas "Geladeira" sem unidade
-- passariam — e a clínica de um endereço só, que é o caso comum, é exatamente
-- a que teria duas.
CREATE UNIQUE INDEX locais_nome_unico
  ON locais_de_estoque (clinica_id, unidade_id, nome_chave) NULLS NOT DISTINCT
  WHERE excluido_em IS NULL;

-- ---------------------------------------------------------------------------
-- ITENS DE ESTOQUE
-- ---------------------------------------------------------------------------
CREATE TABLE itens_de_estoque (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id  uuid NOT NULL REFERENCES clinicas(id),
  nome        text NOT NULL CHECK (length(nome) BETWEEN 1 AND 80),
  nome_chave  text GENERATED ALWAYS AS (normalizar_nome(nome)) STORED,

  -- O código do sistema principal da clínica. É a PRIMEIRA chave da
  -- importação idempotente (regra 26), e o nome é a segunda.
  codigo       text NOT NULL DEFAULT '' CHECK (length(codigo) <= 40),
  codigo_chave text GENERATED ALWAYS AS
                 (nullif(normalizar_nome(codigo), '')) STORED,
  categoria    text NOT NULL DEFAULT '' CHECK (length(categoria) <= 40),

  -- ─── AS TRÊS UNIDADES ───────────────────────────────────────────────────
  -- `medida` é a unidade de ESTOQUE: como a equipe conta na prateleira.
  -- Saldo, contagem e todo movimento são nela.
  medida       text NOT NULL DEFAULT 'un.' CHECK (length(medida) BETWEEN 1 AND 20),
  -- 1 unid_compra = fator_compra × medida, em MILÉSIMOS (1 caixa = 4 ampolas
  -- → 4000).
  unid_compra  text CHECK (unid_compra IS NULL OR length(unid_compra) BETWEEN 1 AND 20),
  fator_compra bigint CHECK (fator_compra IS NULL OR fator_compra > 0),
  -- 1 medida = fator_uso × unid_uso, em MILÉSIMOS (1 ampola = 5 mg → 5000).
  unid_uso     text CHECK (unid_uso IS NULL OR length(unid_uso) BETWEEN 1 AND 20),
  fator_uso    bigint CHECK (fator_uso IS NULL OR fator_uso > 0),

  -- A CONVERSÃO NUNCA VIAJA PELA METADE.
  --
  -- "Caixa" sem dizer quantas ampolas vêm nela não é conversão nenhuma: é um
  -- rótulo que a tela mostraria e que nenhuma conta poderia usar. O protótipo
  -- aceita o par meio preenchido e o descarta na leitura
  -- (`compraItem = it.unidCompra && f > 0 ? … : null`), então a clínica
  -- cadastra "caixa", não vê erro, e a entrada em caixas simplesmente não
  -- aparece como opção.
  CONSTRAINT compra_declarada_por_inteiro
    CHECK ((unid_compra IS NULL) = (fator_compra IS NULL)),
  CONSTRAINT uso_declarado_por_inteiro
    CHECK ((unid_uso IS NULL) = (fator_uso IS NULL)),
  -- Uma unidade de compra ou de uso IGUAL à medida é conversão que não
  -- converte: `paraMedida` casaria a medida primeiro e o fator jamais seria
  -- aplicado, então o número gravado dependeria da ordem dos `if`.
  CONSTRAINT unidades_sao_distintas
    CHECK (unid_compra IS DISTINCT FROM medida AND unid_uso IS DISTINCT FROM medida
           AND (unid_compra IS NULL OR unid_compra IS DISTINCT FROM unid_uso)),

  -- `false` = a sobra do frasco aberto não é usada no próximo paciente, e a
  -- baixa gera DOIS movimentos (regra 15). Padrão `true`: descartável é o caso
  -- comum, e o padrão que gera descarte sozinho seria perda inventada.
  aproveita_sobra   boolean NOT NULL DEFAULT true,
  controla_validade boolean NOT NULL DEFAULT false,
  alta_rotatividade boolean NOT NULL DEFAULT false,
  -- '' = a curva ABC decide; 'sim'/'nao' = a clínica forçou (MANUAL cap. 12).
  alto_valor        text NOT NULL DEFAULT '' CHECK (alto_valor IN ('', 'sim', 'nao')),

  -- Em milésimos de `medida`. `NULL` = o item não tem mínimo, que é diferente
  -- de "o mínimo é zero" — com zero, nenhum item jamais ficaria abaixo dele e
  -- a tarefa de reposição nunca nasceria.
  minimo      bigint CHECK (minimo IS NULL OR minimo >= 0),
  -- CENTAVOS por `medida` (regra 1). Visível só com `estoque.gerir`, e a
  -- redação de valores o apaga pelo nome `custo`.
  custo       bigint CHECK (custo IS NULL OR custo >= 0),

  local_id       uuid REFERENCES locais_de_estoque(id),
  unidade_id     uuid REFERENCES unidades(id),
  responsavel_id uuid REFERENCES pessoas(id),
  -- GS1/EAN da caixa do medicamento. A próxima fatia (`ligarCodigoItem`) a
  -- usa; a coluna nasce aqui porque o cadastro já a aceita.
  gtin        text NOT NULL DEFAULT '' CHECK (gtin ~ '^[0-9]{0,14}$'),

  ativo         boolean NOT NULL DEFAULT true,
  desativado_em timestamptz,
  excluido_em   timestamptz,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  criado_por    uuid REFERENCES pessoas(id),
  CONSTRAINT item_desativado_tem_instante CHECK (ativo = (desativado_em IS NULL))
);

-- As DUAS chaves da importação idempotente (regra 26), nas duas ordens em que
-- o protótipo as tenta: primeiro o código, depois o nome.
--
-- Parciais em `excluido_em IS NULL` e não em `ativo`: item INATIVO continua
-- ocupando o nome, ao contrário de `pacientes`. A razão é o histórico de
-- movimento — recadastrar "Tirzepatida" com o mesmo nome criaria dois itens
-- que a análise do estoque somaria separado, e a clínica veria metade do
-- consumo em cada.
CREATE UNIQUE INDEX itens_de_estoque_nome_unico
  ON itens_de_estoque (clinica_id, nome_chave) WHERE excluido_em IS NULL;
CREATE UNIQUE INDEX itens_de_estoque_codigo_unico
  ON itens_de_estoque (clinica_id, codigo_chave)
  WHERE excluido_em IS NULL AND codigo_chave IS NOT NULL;
CREATE UNIQUE INDEX itens_de_estoque_gtin_unico
  ON itens_de_estoque (clinica_id, gtin) WHERE excluido_em IS NULL AND gtin <> '';
CREATE INDEX itens_de_estoque_por_local ON itens_de_estoque (clinica_id, local_id)
  WHERE excluido_em IS NULL;

COMMENT ON COLUMN itens_de_estoque.medida IS
  'A unidade de ESTOQUE. Saldo é SEMPRE nela (CONTEXT.md, Item de estoque).';
COMMENT ON COLUMN itens_de_estoque.fator_compra IS
  '1 unid_compra = fator_compra × medida, em milésimos. Vive no CADASTRO '
  'porque um número de conversão dentro de uma função é defeito mesmo quando '
  'o resultado está certo hoje (CLAUDE.md, regra 9).';
COMMENT ON COLUMN itens_de_estoque.fator_uso IS
  '1 medida = fator_uso × unid_uso, em milésimos.';

-- ---------------------------------------------------------------------------
-- MOVIMENTOS — APPEND-ONLY (regra 12)
-- ---------------------------------------------------------------------------
CREATE TABLE movimentos_de_estoque (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES clinicas(id),
  item_id    uuid NOT NULL REFERENCES itens_de_estoque(id),

  tipo text NOT NULL
    CHECK (tipo IN ('contagem', 'entrada', 'consumo', 'descarte', 'interno', 'ajuste')),

  -- ASSINADO, em milésimos de `medida`. Jamais na unidade digitada.
  milesimos bigint NOT NULL,

  -- A ORDEM DE GRAVAÇÃO, e ela não é luxo.
  --
  -- `now()` em Postgres é o instante da TRANSAÇÃO: toda linha escrita junta
  -- compartilha `em` EXATAMENTE. A baixa de uma sessão grava consumo e
  -- descarte na mesma transação; `salvarItemEstoque` grava o item e a contagem
  -- inicial na mesma. Sem um desempate monotônico, uma contagem e uma entrada
  -- do mesmo instante ordenariam de forma arbitrária, e o saldo do item
  -- mudaria entre duas leituras do mesmo dado.
  sequencia bigserial NOT NULL,

  -- Dia CIVIL no fuso da clínica (regra 22). O lançamento retroativo de uma
  -- entrada de ontem conta antes da contagem de hoje, mesmo digitado depois.
  dia date NOT NULL,
  em  timestamptz NOT NULL DEFAULT now(),

  -- O LOTE É A VALIDADE, e o FIFO é por ela (regra 15). `NULL` quando o item
  -- não controla validade.
  lote date,

  -- Centavos por `medida`, só em entrada. Redigido pelo nome `custo`.
  custo  bigint CHECK (custo IS NULL OR custo >= 0),
  motivo text NOT NULL DEFAULT '' CHECK (length(motivo) <= 40),
  obs    text NOT NULL DEFAULT '' CHECK (length(obs) <= 120),

  -- ─── DADO DE SAÚDE (LGPD art. 11, regra 18) ─────────────────────────────
  -- Dose, produto, lote e aplicação POR PACIENTE. Acesso por perfil, registro
  -- de acesso, e nunca em log.
  paciente_id     uuid REFERENCES pacientes(id),
  procedimento_id uuid REFERENCES procedimentos(id),
  aplicado_por_id uuid REFERENCES pessoas(id),

  -- ─── A LIGAÇÃO COM A ORIGEM DA BAIXA AUTOMÁTICA ─────────────────────────
  -- `tarefa_id` é a sessão (ou o atendimento) que pediu a baixa, e é por ele
  -- que `desfazer` acha o que compensar.
  tarefa_id   uuid REFERENCES tarefas(id),
  programa_id uuid REFERENCES programas(id),
  item_chave  text CHECK (item_chave IS NULL OR length(item_chave) BETWEEN 1 AND 10),

  -- ─── A COMPENSAÇÃO ──────────────────────────────────────────────────────
  -- Aponta para a linha que ela reverte. `UNIQUE` logo abaixo: um movimento é
  -- compensado NO MÁXIMO UMA VEZ, e é isso que torna `desfazer` idempotente
  -- sem nenhum `if` no serviço.
  compensa_id     uuid REFERENCES movimentos_de_estoque(id),
  compensa_motivo text NOT NULL DEFAULT ''
    CHECK (compensa_motivo IN ('', 'sessao-reaberta', 'programa-excluido', 'correcao')),

  criado_por uuid REFERENCES pessoas(id),

  -- O SINAL VEM DO TIPO, exceto na compensação — que carrega o sinal OPOSTO ao
  -- da origem, mantendo o tipo dela.
  --
  -- Manter o tipo (em vez de um sétimo tipo 'compensacao') é o que faz a
  -- análise do estoque continuar certa de graça: o consumo do período soma os
  -- movimentos de `consumo`, e a reabertura de uma sessão o zera por soma, sem
  -- a análise precisar aprender um tipo novo.
  CONSTRAINT sinal_combina_com_tipo CHECK (
    compensa_id IS NOT NULL OR CASE tipo
      WHEN 'contagem' THEN milesimos >= 0
      WHEN 'entrada'  THEN milesimos > 0
      WHEN 'ajuste'   THEN milesimos <> 0
      ELSE milesimos < 0
    END
  ),

  -- Contagem é um PONTO DE PARTIDA, não um delta: ela não tem lote por
  -- movimento nem compensação, e nunca compensa nada.
  CONSTRAINT contagem_nao_compensa CHECK (tipo <> 'contagem' OR compensa_id IS NULL),
  CONSTRAINT compensacao_tem_motivo
    CHECK ((compensa_id IS NULL) = (compensa_motivo = '')),

  -- Custo é de ENTRADA. Um custo em `consumo` seria um segundo preço para o
  -- mesmo item, e a análise do estoque não sabe qual dos dois usar.
  CONSTRAINT custo_e_de_entrada CHECK (custo IS NULL OR tipo = 'entrada'),

  -- `ajuste` e `interno` EXIGEM motivo — é a regra 13 e o MANUAL cap. 12
  -- ("o motivo é obrigatório"). Sem ele, a diferença da análise deixa de ser
  -- explicável, que é o produto inteiro do módulo.
  CONSTRAINT ajuste_e_interno_tem_motivo
    CHECK (tipo NOT IN ('ajuste', 'interno') OR compensa_id IS NOT NULL OR btrim(motivo) <> ''),

  -- Consumo em paciente exige o paciente. "Uso interno ou cortesia" é o tipo
  -- `interno`, que existe justamente para a saída sem paciente — então um
  -- `consumo` sem paciente é lançamento no tipo errado, não um caso.
  CONSTRAINT consumo_tem_paciente
    CHECK (tipo <> 'consumo' OR compensa_id IS NOT NULL OR paciente_id IS NOT NULL)
);

-- **A IDEMPOTÊNCIA DE `desfazer`, NO ESQUEMA.**
--
-- Reabrir a sessão duas vezes, ou reabrir e depois excluir o programa, acontece
-- no balcão. Sem este índice, cada chamada inseriria outra compensação e o
-- estoque CRESCERIA por causa de um toque repetido — e a corrida entre duas
-- abas venceria qualquer `SELECT` antes do `INSERT`.
CREATE UNIQUE INDEX movimentos_compensa_uma_vez
  ON movimentos_de_estoque (compensa_id) WHERE compensa_id IS NOT NULL;

-- A consulta de saldo lê TODOS os movimentos de um item, na ordem canônica.
CREATE INDEX movimentos_do_item
  ON movimentos_de_estoque (clinica_id, item_id, dia, em, sequencia);
-- `desfazer` acha o que compensar por `tarefa_id`.
CREATE INDEX movimentos_por_tarefa
  ON movimentos_de_estoque (clinica_id, tarefa_id) WHERE tarefa_id IS NOT NULL;
-- A ficha da paciente lê a aplicação dela (dado de saúde, acesso registrado).
CREATE INDEX movimentos_por_paciente
  ON movimentos_de_estoque (clinica_id, paciente_id) WHERE paciente_id IS NOT NULL;

COMMENT ON TABLE movimentos_de_estoque IS
  'APPEND-ONLY (regra 12). Desfazer uma baixa é inserir uma compensação '
  'ligada à origem por compensa_id, nunca um DELETE nem um UPDATE. Saldo é '
  'DERIVADO daqui (regra 11): última contagem + entradas − saídas ± ajustes.';
COMMENT ON COLUMN movimentos_de_estoque.milesimos IS
  'ASSINADO, em milésimos de itens_de_estoque.medida. A nota chega em caixas e '
  'a dose em mg; as duas são convertidas na borda por paraMedida, e o que se '
  'grava é sempre a unidade de estoque.';
COMMENT ON COLUMN movimentos_de_estoque.lote IS
  'A VALIDADE do lote. O FIFO é por ela, e desfazer devolve ao MESMO lote — '
  'saldo certo com lote errado é a dose do frasco vencido na próxima paciente.';

-- ---------------------------------------------------------------------------
-- CAMADA 1 DO APPEND-ONLY: o privilégio.
--
-- `fir_app` lê e insere; nunca altera nem apaga. Mesmo par de camadas de
-- `auditoria` (0004): o GRANT sozinho não protege (o `ALTER DEFAULT
-- PRIVILEGES` do bootstrap concede os quatro), então quem faz o trabalho é o
-- REVOKE.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT ON movimentos_de_estoque TO fir_app;
REVOKE UPDATE, DELETE, TRUNCATE ON movimentos_de_estoque FROM fir_app;
GRANT USAGE, SELECT ON SEQUENCE movimentos_de_estoque_sequencia_seq TO fir_app;

-- ---------------------------------------------------------------------------
-- CAMADA 2: a trigger, que alcança o DONO.
--
-- O REVOKE acima não alcança `fir_migrate`, que é dono e tem BYPASSRLS: um
-- `UPDATE movimentos_de_estoque` dele — numa migration de dados, num script de
-- correção, num psql às duas da manhã — passaria sem aviso. Sozinha, a camada 1
-- seria teatro.
--
-- `FOR EACH STATEMENT`: a recusa não depende de haver linha afetada. Um
-- `UPDATE … WHERE false` que passasse em silêncio ensinaria que "às vezes dá".
-- ---------------------------------------------------------------------------
CREATE FUNCTION movimento_e_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'movimento de estoque é append-only: % recusado', TG_OP
    USING HINT = 'Desfazer uma baixa é inserir uma compensação com compensa_id, nunca editar.';
END $$;

CREATE TRIGGER movimentos_sem_update
  BEFORE UPDATE OR DELETE OR TRUNCATE ON movimentos_de_estoque
  FOR EACH STATEMENT EXECUTE FUNCTION movimento_e_append_only();

-- ---------------------------------------------------------------------------
-- A COMPENSAÇÃO ESPELHA A ORIGEM — e isto não cabe num `CHECK`.
--
-- `CHECK` não vê outra linha. O invariante do seam `BaixaDeInsumos` é que
-- `desfazer` restaura **EXATAMENTE** o que `baixar` tirou: mesma quantidade,
-- MESMO LOTE, mesmo item. Saldo certo com lote errado é a dose do frasco
-- vencido aplicada na próxima paciente — e é um erro que nenhuma tela mostra.
--
-- Deixar isso só no serviço seria confiar em quem escrever o segundo caminho de
-- reversão (a exclusão de programa já é o segundo). Aqui o banco recusa.
-- ---------------------------------------------------------------------------
CREATE FUNCTION compensacao_espelha_a_origem() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
  AS $$
DECLARE o public.movimentos_de_estoque;
BEGIN
  IF NEW.compensa_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO o FROM public.movimentos_de_estoque WHERE id = NEW.compensa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'compensação aponta para movimento inexistente: %', NEW.compensa_id;
  END IF;

  IF o.compensa_id IS NOT NULL THEN
    RAISE EXCEPTION 'compensação de compensação não existe: % já reverte %',
      o.id, o.compensa_id
      USING HINT = 'Para refazer a baixa, insira o movimento original de novo.';
  END IF;
  IF o.item_id <> NEW.item_id THEN
    RAISE EXCEPTION 'compensação de item diferente: origem % , nova %', o.item_id, NEW.item_id;
  END IF;
  IF o.tipo <> NEW.tipo THEN
    RAISE EXCEPTION 'compensação de tipo diferente: origem % , nova %', o.tipo, NEW.tipo;
  END IF;
  IF o.lote IS DISTINCT FROM NEW.lote THEN
    RAISE EXCEPTION 'compensação em LOTE diferente: origem % , nova %', o.lote, NEW.lote
      USING HINT = 'Desfazer devolve ao mesmo lote. Saldo certo com lote errado é a dose do frasco vencido.';
  END IF;
  IF o.milesimos <> -NEW.milesimos THEN
    RAISE EXCEPTION 'compensação não espelha a quantidade: origem % , nova %',
      o.milesimos, NEW.milesimos;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER movimentos_compensacao_espelha
  BEFORE INSERT ON movimentos_de_estoque
  FOR EACH ROW EXECUTE FUNCTION compensacao_espelha_a_origem();

COMMENT ON FUNCTION compensacao_espelha_a_origem() IS
  'A compensação tem o MESMO item, o MESMO tipo, o MESMO lote e a quantidade '
  'OPOSTA da origem. É o invariante do seam BaixaDeInsumos, cobrado pelo banco '
  'porque CHECK não alcança outra linha.';

-- ---------------------------------------------------------------------------
-- RLS + TRILHA, nas três tabelas.
--
-- `FORCE` para que nem o dono escape. A policy filtra por clínica com AND e
-- nada mais — `isolamento-de-clinica.test.ts` recusa qualquer `OR` nela, porque
-- `USING (clinica_id = app_clinica_id() OR true)` abre a tabela inteira sem
-- mudar de cor.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['locais_de_estoque', 'itens_de_estoque', 'movimentos_de_estoque'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I_por_clinica ON %I USING (clinica_id = app_clinica_id()) '
      'WITH CHECK (clinica_id = app_clinica_id())', t, t);
    -- A trilha (regra 20): quem, quando, de → para. Nada de `registrar()` à
    -- mão em serviço nenhum.
    EXECUTE format(
      'CREATE TRIGGER %I_auditoria AFTER INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION registrar_auditoria()', t, t);
  END LOOP;

  -- `movimentos_de_estoque` já recebeu SELECT/INSERT acima, com o REVOKE do
  -- resto. As outras duas são editáveis: desativar um local é um `UPDATE`.
  FOREACH t IN ARRAY ARRAY['locais_de_estoque', 'itens_de_estoque'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO fir_app', t);
  END LOOP;
END $$;

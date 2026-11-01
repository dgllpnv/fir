-- ---------------------------------------------------------------------------
-- A CONTAGEM ÀS CEGAS, A NOTA DE ENTRADA E O CÓDIGO DO ITEM.
--
-- Fecha o épico 6: `criarContagem`, `salvarContagem`, `entradaNota` e
-- `ligarCodigoItem`. As quatro decisões que esta migration fixa:
--
--  1. **A CONTAGEM DE UM ITEM COM VALIDADE É UM GRUPO DE MOVIMENTOS.** A
--     prateleira com 2 frascos de junho e 1 de setembro produz DUAS linhas de
--     `contagem`, uma por lote — porque há uma coluna `lote` por linha, e a
--     0015 recusou de propósito um saldo por lote que não corresponda a
--     movimento nenhum. O que amarra as linhas é `movimentos_de_estoque.
--     contagem_id`: sem ele, `saldoEmMedida` leria só a ÚLTIMA e os outros
--     dois frascos desapareceriam do estoque sem erro na tela.
--
--  2. **O ESPERADO NÃO É COLUNA.** Nem o esperado, nem a diferença, nem o
--     contado total. Os três são DERIVADOS dos movimentos por
--     `analiseDaContagem` (regra 11) — e a razão aqui é mais forte que a
--     economia de espaço: um `esperado` gravado é um número que PODE ser lido
--     antes do fechamento, e a regra 14 é invariante de TRANSPORTE. O que não
--     existe no banco não vaza por um `SELECT *` que alguém escreveu com
--     pressa.
--
--  3. **A IDEMPOTÊNCIA DA NOTA É DO ESQUEMA** (regra 26), por DUAS chaves: a
--     chave de acesso da NF-e (44 dígitos) e, para a nota digitada à mão, o
--     par emissor + número. Reimportar o mesmo XML três vezes não cria nada
--     novo porque o `INSERT` é recusado pelo índice, não porque um serviço
--     leu antes de escrever — leitura antes de escrita perde a corrida entre
--     duas abas.
--
--  4. **O GTIN LIGA UMA VEZ.** `ligarCodigoItem` grava o código de barras da
--     caixa no item, e o índice único da 0015 já impede que o mesmo código
--     aponte para dois itens.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- A LISTA DE CONTAGEM
--
-- "A lista vira uma tarefa estratégica para o responsável, com os itens para
-- contar. Pode imprimir e contar no papel." (MANUAL cap. 12)
-- ---------------------------------------------------------------------------
CREATE TABLE contagens_de_estoque (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES clinicas(id),
  nome       text NOT NULL CHECK (length(nome) BETWEEN 1 AND 100),

  -- COMO a lista foi montada, para a tela repetir a escolha e para o histórico
  -- dizer o que foi contado. O servidor é quem RESOLVE o filtro em itens (a
  -- curva ABC depende de custo, que a enfermagem não vê) — então guardar o
  -- filtro aqui não é guardar a lista: a lista está em `itens_da_contagem`.
  filtro      text NOT NULL DEFAULT 'todos'
    CHECK (filtro IN ('todos', 'rotatividade', 'altoValor', 'categoria', 'semContagem')),
  categoria   text NOT NULL DEFAULT '' CHECK (length(categoria) <= 40),
  local_id    uuid REFERENCES locais_de_estoque(id),
  unidade_id  uuid REFERENCES unidades(id),

  responsavel_id uuid NOT NULL REFERENCES pessoas(id),
  -- Dia civil no fuso da clínica (regra 22): "contar até".
  prazo       date NOT NULL,
  -- A rotina: ao concluir, a próxima já nasce (MANUAL cap. 12).
  repetir     text NOT NULL DEFAULT '' CHECK (repetir IN ('', 'quinzenal', 'mensal')),

  situacao    text NOT NULL DEFAULT 'aberta' CHECK (situacao IN ('aberta', 'concluida')),
  concluida_em date,
  -- A tarefa que leva a lista para a lista de afazeres de quem vai contar.
  tarefa_id   uuid REFERENCES tarefas(id),
  -- A contagem que criou esta, quando ela nasceu da repetição. É o que faz a
  -- série legível sem uma coluna `serie_id` que ninguém preencheria.
  anterior_id uuid REFERENCES contagens_de_estoque(id),

  criada_em   timestamptz NOT NULL DEFAULT now(),
  criada_por  uuid REFERENCES pessoas(id),

  CONSTRAINT contagem_concluida_tem_dia
    CHECK ((situacao = 'concluida') = (concluida_em IS NOT NULL)),
  -- `categoria` só existe no filtro por categoria, e é OBRIGATÓRIA nele: um
  -- filtro 'categoria' sem categoria resolveria para o catálogo inteiro, e a
  -- lista de "Injetáveis" sairia com as seringas dentro.
  CONSTRAINT contagem_categoria_combina_com_filtro
    CHECK ((filtro = 'categoria') = (btrim(categoria) <> '')),

  -- A COMPOSTA com a clínica, como as de `tarefas` e a de `itens_de_estoque`
  -- na 0016: sem a clínica junto, a chave estrangeira de
  -- `movimentos_de_estoque.contagem_id` aceitaria a contagem da clínica
  -- vizinha, e a RLS só esconderia a leitura.
  CONSTRAINT contagens_clinica_id_id_key UNIQUE (clinica_id, id)
);

CREATE UNIQUE INDEX contagem_tarefa_unica
  ON contagens_de_estoque (tarefa_id) WHERE tarefa_id IS NOT NULL;
CREATE INDEX contagens_abertas ON contagens_de_estoque (clinica_id, prazo)
  WHERE situacao = 'aberta';
CREATE INDEX contagens_por_criacao ON contagens_de_estoque (clinica_id, criada_em DESC);

COMMENT ON TABLE contagens_de_estoque IS
  'A lista de contagem. NÃO guarda esperado, contado nem diferença: os três '
  'são derivados dos movimentos (regra 11), e um esperado gravado é um número '
  'que pode vazar antes do fechamento (regra 14).';

-- ---------------------------------------------------------------------------
-- OS ITENS DA LISTA — a membresia, e nada mais
--
-- Uma linha por item a contar. **Sem quantidade**: o que foi contado mora em
-- `contado_na_contagem`, uma linha por LOTE. Duas tabelas porque são duas
-- perguntas — "o que contar" e "quanto se achou" —, e juntá-las obrigaria a
-- linha de membresia a ter um lote nulo que não significa nada.
-- ---------------------------------------------------------------------------
CREATE TABLE itens_da_contagem (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id  uuid NOT NULL REFERENCES clinicas(id),
  contagem_id uuid NOT NULL REFERENCES contagens_de_estoque(id),
  item_id     uuid NOT NULL,
  CONSTRAINT item_da_contagem_e_da_clinica
    FOREIGN KEY (clinica_id, item_id) REFERENCES itens_de_estoque (clinica_id, id),
  CONSTRAINT itens_da_contagem_unico UNIQUE (contagem_id, item_id)
);

CREATE INDEX itens_da_contagem_por_contagem ON itens_da_contagem (contagem_id);

-- ---------------------------------------------------------------------------
-- O QUE FOI CONTADO — o rascunho, uma linha por LOTE
--
-- Esta é a ÚNICA tabela mutável do módulo, e isso é deliberado: "Salvar e
-- continuar depois" é o MANUAL, e o rascunho de quem está com a prancheta na
-- mão não é o livro-razão. O livro-razão é `movimentos_de_estoque`, que nasce
-- no FECHAMENTO e é append-only.
--
-- `NULLS NOT DISTINCT` no único: item que não controla validade tem UMA linha,
-- com `lote` nulo, e o padrão `NULLS DISTINCT` deixaria gravar duas.
-- ---------------------------------------------------------------------------
CREATE TABLE contado_na_contagem (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id  uuid NOT NULL REFERENCES clinicas(id),
  contagem_id uuid NOT NULL REFERENCES contagens_de_estoque(id),
  item_id     uuid NOT NULL,
  -- A validade do lote contado. `NULL` = o item não controla validade, ou a
  -- prateleira estava vazia (contado zero não tem lote).
  lote        date,
  -- Milésimos de `medida`, NUNCA negativo: contar é achar, e não se acha −1.
  milesimos   bigint NOT NULL CHECK (milesimos >= 0),
  contado_em  timestamptz NOT NULL DEFAULT now(),
  contado_por uuid REFERENCES pessoas(id),

  CONSTRAINT contado_e_de_item_da_lista
    FOREIGN KEY (contagem_id, item_id) REFERENCES itens_da_contagem (contagem_id, item_id),
  CONSTRAINT contado_e_da_clinica
    FOREIGN KEY (clinica_id, item_id) REFERENCES itens_de_estoque (clinica_id, id)
);

CREATE UNIQUE INDEX contado_por_lote_unico
  ON contado_na_contagem (contagem_id, item_id, lote) NULLS NOT DISTINCT;

COMMENT ON TABLE contado_na_contagem IS
  'O RASCUNHO da contagem, mutável até o fechamento. O livro-razão é '
  'movimentos_de_estoque, que nasce no fechamento e é append-only.';

-- ---------------------------------------------------------------------------
-- O GRUPO DE CONTAGEM NO MOVIMENTO
--
-- É o que torna "2 frascos de junho e 1 de setembro" UMA contagem. Ver a
-- decisão 1 no topo, e `chaveDaContagem` em `packages/domain/src/estoque.ts`:
-- a contagem SOLTA de `movEstoque` continua sendo seu próprio grupo, pelo id.
-- ---------------------------------------------------------------------------
ALTER TABLE movimentos_de_estoque ADD COLUMN contagem_id uuid;
ALTER TABLE movimentos_de_estoque ADD CONSTRAINT movimento_de_contagem_existe
  FOREIGN KEY (clinica_id, contagem_id) REFERENCES contagens_de_estoque (clinica_id, id);
ALTER TABLE movimentos_de_estoque ADD CONSTRAINT grupo_e_de_contagem
  CHECK (contagem_id IS NULL OR tipo = 'contagem');

CREATE INDEX movimentos_por_contagem
  ON movimentos_de_estoque (clinica_id, contagem_id) WHERE contagem_id IS NOT NULL;

COMMENT ON COLUMN movimentos_de_estoque.contagem_id IS
  'O GRUPO de contagem: uma linha por lote contado, todas da mesma contagem. '
  'Sem ele, o saldo leria só a última linha e os outros lotes desapareceriam.';

-- ---------------------------------------------------------------------------
-- A TAREFA DE REPOSIÇÃO — "Repor estoque: X (tem 2, mínimo 4 ampolas)"
--
-- O protótipo evita a tarefa duplicada com um `some(t => t.estoqueRef ===
-- "item:"+id && t.status === "aberta")`. Aqui a regra é um ÍNDICE: no máximo
-- UMA tarefa de reposição viva por item. Com o `if` no serviço, duas
-- contagens concluídas ao mesmo tempo criariam duas tarefas para o mesmo
-- item, e a segunda só apareceria na lista de quem vai comprar.
--
-- Coluna, e não `marcador` com o id dentro: `marcador` tem 40 caracteres e um
-- uuid tem 36 — o prefixo não cabe. E chave estrangeira de verdade não é
-- string encodada.
-- ---------------------------------------------------------------------------
ALTER TABLE tarefas ADD COLUMN item_de_estoque_id uuid;
ALTER TABLE tarefas ADD CONSTRAINT tarefa_de_item_de_estoque_existe
  FOREIGN KEY (clinica_id, item_de_estoque_id) REFERENCES itens_de_estoque (clinica_id, id);

CREATE UNIQUE INDEX tarefa_de_reposicao_viva
  ON tarefas (clinica_id, item_de_estoque_id)
  WHERE item_de_estoque_id IS NOT NULL AND status = 'aberta' AND excluida_em IS NULL;

COMMENT ON COLUMN tarefas.item_de_estoque_id IS
  'A tarefa de REPOSIÇÃO deste item. O índice parcial tarefa_de_reposicao_viva '
  'garante no máximo uma viva por item — idempotência sem lock.';

-- ---------------------------------------------------------------------------
-- A NOTA DE ENTRADA — `entradaNota`
--
-- IDEMPOTENTE POR DUAS CHAVES (regra 26):
--
--  * `chave` — a chave de acesso da NF-e, 44 dígitos, única no país. É ela
--    que o XML traz no atributo `Id` de `infNFe`, e é ela que faz reimportar
--    o mesmo arquivo três vezes não criar nada novo.
--
--  * `(emissor_chave, numero)` — para a nota DIGITADA, que não tem chave de
--    acesso. Mesma distribuidora, mesmo número: é a mesma nota. O protótipo
--    não dedupa este caminho, e lançar a nota duas vezes dobra o estoque de
--    um item caro sem nenhum aviso — é o mesmo erro de categoria da receita
--    dobrada (regra 3), do outro lado do balcão.
--
-- `emissor_chave` é o CNPJ quando há, e o nome normalizado do fornecedor
-- quando não: sem isso, duas distribuidoras com nota nº 123 colidiriam no
-- balde do CNPJ vazio.
-- ---------------------------------------------------------------------------
CREATE TABLE notas_de_entrada (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES clinicas(id),

  -- 44 dígitos, ou nada. Um "quase" (43 dígitos de um OCR ruim) não é chave
  -- de acesso e não pode virar chave de idempotência.
  chave      text CHECK (chave IS NULL OR chave ~ '^[0-9]{44}$'),
  numero     text NOT NULL DEFAULT '' CHECK (length(numero) <= 20),
  fornecedor text NOT NULL DEFAULT '' CHECK (length(fornecedor) <= 80),
  cnpj       text NOT NULL DEFAULT '' CHECK (cnpj ~ '^[0-9]{0,14}$'),
  emissor_chave text GENERATED ALWAYS AS
    (coalesce(nullif(cnpj, ''), nullif(normalizar_nome(fornecedor), ''))) STORED,

  -- Dia civil no fuso da clínica: a emissão, que é também o dia dos
  -- movimentos de entrada.
  dia        date NOT NULL,
  registrada_em timestamptz NOT NULL DEFAULT now(),
  registrada_por uuid REFERENCES pessoas(id),

  CONSTRAINT nota_clinica_id_id_key UNIQUE (clinica_id, id)
);

CREATE UNIQUE INDEX nota_chave_de_acesso_unica
  ON notas_de_entrada (clinica_id, chave) WHERE chave IS NOT NULL;
CREATE UNIQUE INDEX nota_emissor_e_numero_unicos
  ON notas_de_entrada (clinica_id, emissor_chave, numero)
  WHERE numero <> '' AND emissor_chave IS NOT NULL;

ALTER TABLE movimentos_de_estoque ADD COLUMN nota_id uuid;
ALTER TABLE movimentos_de_estoque ADD CONSTRAINT movimento_de_nota_existe
  FOREIGN KEY (clinica_id, nota_id) REFERENCES notas_de_entrada (clinica_id, id);
-- Nota é de ENTRADA. Um `consumo` com nota seria a nota explicando uma saída,
-- que não é o que uma nota de compra é.
ALTER TABLE movimentos_de_estoque ADD CONSTRAINT nota_e_de_entrada
  CHECK (nota_id IS NULL OR tipo = 'entrada');

CREATE INDEX movimentos_por_nota
  ON movimentos_de_estoque (clinica_id, nota_id) WHERE nota_id IS NOT NULL;

COMMENT ON TABLE notas_de_entrada IS
  'A NF-e lançada. A idempotência (regra 26) é do ESQUEMA: chave de acesso '
  'quando há, emissor + número quando não. Reimportar o mesmo XML três vezes '
  'não cria nada novo porque o INSERT é recusado, não porque um if leu antes.';

-- ---------------------------------------------------------------------------
-- O VÍNCULO DO PRODUTO DO FORNECEDOR COM O ITEM DO ESTOQUE
--
-- "A ferramenta guarda essa ligação para as próximas notas desse fornecedor"
-- (MANUAL cap. 12). A segunda nota da mesma distribuidora já chega casada, e
-- com o fator de conversão que a clínica confirmou na primeira — 1 CX = 10
-- ampolas é conhecimento da clínica, não do código (regra 9).
--
-- A chave é `(cnpj, codigo)`: o `cProd` é único dentro do emissor, nunca
-- entre emissores. Sem o CNPJ na chave, o "MJ5-01" de uma distribuidora
-- casaria com o item ligado ao "MJ5-01" de outra.
-- ---------------------------------------------------------------------------
CREATE TABLE vinculos_de_nota (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES clinicas(id),
  -- '' = fornecedor sem CNPJ informado (nota digitada). É UM balde que
  -- deduplica, como "sem unidade" nos locais.
  cnpj       text NOT NULL DEFAULT '' CHECK (cnpj ~ '^[0-9]{0,14}$'),
  codigo     text NOT NULL CHECK (length(codigo) BETWEEN 1 AND 60),
  item_id    uuid NOT NULL,
  -- Quantas `medida` vêm em 1 unidade da NOTA, em milésimos. 1 CX = 10
  -- ampolas → 10000. NUNCA um número em código.
  fator      bigint NOT NULL CHECK (fator > 0),
  descricao  text NOT NULL DEFAULT '' CHECK (length(descricao) <= 80),
  criado_em  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT vinculo_e_da_clinica
    FOREIGN KEY (clinica_id, item_id) REFERENCES itens_de_estoque (clinica_id, id),
  CONSTRAINT vinculo_unico UNIQUE (clinica_id, cnpj, codigo)
);

CREATE INDEX vinculos_por_item ON vinculos_de_nota (clinica_id, item_id);

-- ---------------------------------------------------------------------------
-- RLS + TRILHA nas cinco tabelas novas.
--
-- `FORCE` para que nem o dono escape. A policy filtra por clínica com AND e
-- nada mais — `isolamento-de-clinica.test.ts` recusa qualquer `OR` nela.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contagens_de_estoque', 'itens_da_contagem',
                           'contado_na_contagem', 'notas_de_entrada',
                           'vinculos_de_nota'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I_por_clinica ON %I USING (clinica_id = app_clinica_id()) '
      'WITH CHECK (clinica_id = app_clinica_id())', t, t);
    EXECUTE format(
      'CREATE TRIGGER %I_auditoria AFTER INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION registrar_auditoria()', t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO fir_app', t);
  END LOOP;
END $$;

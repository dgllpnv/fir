-- ---------------------------------------------------------------------------
-- ÉPICO 5 — O CATÁLOGO, O PROGRAMA E A SESSÃO QUE SABE DE QUEM É.
--
-- O vocabulário, e ele é armadilha. No legado, a aba `Planos` é o CATÁLOGO da
-- clínica e a aba `Adesoes` é o tratamento DE UMA PACIENTE. Aqui eles se
-- chamam `procedimentos` e `programas`, e a palavra "plano" não aparece em
-- nome de coluna nenhum. A única exceção é a string `'Sessão de plano'` em
-- `tarefas.tipo`, que é deliberada: ela está gravada em milhares de linhas
-- nas 4 clínicas, e renomeá-la obrigaria o migrador a reescrever dado para
-- ganhar nada.
--
-- NOTA DE MIGRAÇÃO (épico 9): as 4 clínicas JÁ receberam estes cinco modelos
-- pelo `criarModelosPlanos` do `Code.gs`, e já os editaram. O migrador
-- RECONCILIA por `nome_chave` — um `INSERT` cego colidiria com
-- `procedimentos_nome_unico`. Reconciliar, não inserir. E a conversão
-- "adesão antiga = programa de um item `i1`" acontece lá, uma vez: no modelo
-- relacional não existe programa sem itens.
--
-- Faz DML em tabela de negócio (semeia o catálogo), então declara o ATOR: a
-- trigger `registrar_auditoria` da 0004 recusa escrita sem ele.
-- ---------------------------------------------------------------------------
SELECT set_config('app.pessoa_id', 'sistema', true);

-- ---------------------------------------------------------------------------
-- PRÉ-REQUISITO DAS CHAVES ESTRANGEIRAS COMPOSTAS.
--
-- A verificação de FK roda PELO SISTEMA e atravessa a RLS: com
-- `REFERENCES pacientes(id)`, o paciente da clínica vizinha cola num programa
-- daqui. Medido no épico 2 (commit d0d4bb0) e corrigido no épico 3 pela FK
-- composta. Aqui ela é a regra, não a exceção.
--
-- Não é redundante com a chave primária: uma FK só pode apontar para colunas
-- cobertas por uma CONSTRAINT única, e é este par que carrega a clínica.
-- ---------------------------------------------------------------------------
ALTER TABLE pacientes ADD CONSTRAINT pacientes_id_clinica UNIQUE (id, clinica_id);
ALTER TABLE tarefas   ADD CONSTRAINT tarefas_id_clinica   UNIQUE (id, clinica_id);

-- ---------------------------------------------------------------------------
-- PROCEDIMENTOS — o CATÁLOGO da clínica (aba `Planos` da v20).
-- ---------------------------------------------------------------------------
CREATE TABLE procedimentos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id    uuid NOT NULL REFERENCES clinicas(id),
  nome          text NOT NULL CHECK (length(nome) BETWEEN 1 AND 80),
  -- `normalizar_nome` é da 0006. Reusada de propósito: duas normalizações de
  -- nome no mesmo banco é como "Tirzepatida" e "tirzepatida" viram dois
  -- procedimentos e o relatório conta a mesma paciente duas vezes.
  nome_chave    text GENERATED ALWAYS AS (normalizar_nome(nome)) STORED,

  -- SUGERIDOS. Mudá-los NÃO toca em quem já está em tratamento (MANUAL
  -- cap. 11) — e é por isso que as sessões são materializadas (decisão P-1).
  sessoes_sugeridas        smallint NOT NULL CHECK (sessoes_sugeridas BETWEEN 1 AND 104),
  intervalo_sugerido_dias  smallint NOT NULL CHECK (intervalo_sugerido_dias BETWEEN 1 AND 180),
  rotulo_sessao            text NOT NULL DEFAULT 'Sessão' CHECK (length(rotulo_sessao) BETWEEN 1 AND 40),
  responsavel_id           uuid REFERENCES pessoas(id),

  -- Centavos, POR SESSÃO. Regra 1. É referência, não receita (regra 4).
  valor_por_sessao bigint CHECK (valor_por_sessao IS NULL OR valor_por_sessao > 0),

  -- REPETIÇÃO: de quanto em quanto tempo pode repetir, e quantos dias antes
  -- fazer o contato. `retorno_quantidade` nulo = não há contato de retorno.
  retorno_quantidade        smallint,
  retorno_unidade           text NOT NULL DEFAULT 'm' CHECK (retorno_unidade IN ('d','m')),
  retorno_antecedencia_dias smallint NOT NULL DEFAULT 15
                              CHECK (retorno_antecedencia_dias BETWEEN 0 AND 90),
  retorno_responsavel_id    uuid REFERENCES pessoas(id),

  -- BAIXA NO ESTOQUE: o insumo principal e a dose padrão. `insumo_padrao_id`
  -- é do épico 6 e AINDA NÃO TEM FK — a tabela `itens_de_estoque` não existe.
  -- A FK entra na migration do épico 6, por expand, e o teste de órfãos é de
  -- lá.
  insumo_padrao_id        uuid,
  insumo_padrao_milesimos bigint CHECK (insumo_padrao_milesimos IS NULL OR insumo_padrao_milesimos > 0),
  -- A UNIDADE em que a dose foi declarada. Sem ela, "2500" é mg, ampola ou
  -- UI conforme quem lê — e é assim que se aplica a dose errada (regra 10).
  insumo_padrao_unidade   text CHECK (insumo_padrao_unidade IS NULL OR length(insumo_padrao_unidade) BETWEEN 1 AND 20),

  ativo         boolean NOT NULL DEFAULT true,
  desativado_em timestamptz,
  -- Soft delete (regra 20): o histórico e o contato de retorno das pacientes
  -- dependem do item que aponta para cá.
  excluido_em   timestamptz,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  criado_por    uuid REFERENCES pessoas(id),

  CONSTRAINT desativado_tem_instante CHECK ((NOT ativo) = (desativado_em IS NOT NULL)),
  CONSTRAINT retorno_positivo CHECK (
    retorno_quantidade IS NULL OR (retorno_quantidade > 0 AND retorno_quantidade <=
      CASE retorno_unidade WHEN 'd' THEN 1825 ELSE 60 END)),
  -- A DOSE NUNCA ANDA SEM A UNIDADE.
  CONSTRAINT insumo_padrao_tem_unidade CHECK (
    (insumo_padrao_id IS NULL) = (insumo_padrao_milesimos IS NULL)
    AND (insumo_padrao_milesimos IS NULL) = (insumo_padrao_unidade IS NULL)),
  CONSTRAINT procedimentos_id_clinica UNIQUE (id, clinica_id)
);

-- Parcial em `ativo` E em `excluido_em`: desativar ou excluir LIBERA o nome,
-- para que a clínica possa recadastrar "Peeling" depois de aposentar o
-- antigo sem perder a história de quem já fez.
CREATE UNIQUE INDEX procedimentos_nome_unico ON procedimentos (clinica_id, nome_chave)
  WHERE ativo AND excluido_em IS NULL;
CREATE INDEX procedimentos_da_clinica ON procedimentos (clinica_id, nome)
  WHERE excluido_em IS NULL;

COMMENT ON TABLE procedimentos IS
  'O CATÁLOGO da clínica (aba `Planos` da v20). Nunca "plano": a aba se chama '
  'Planos, o campo se chama planoId, e os dois significam coisas diferentes '
  'em telas diferentes. É a ambiguidade mais cara do legado (CONTEXT.md).';
COMMENT ON COLUMN procedimentos.sessoes_sugeridas IS
  'SUGESTÃO para novas adesões. Mudá-la não toca em quem já está em '
  'tratamento — é o que a materialização das sessões (P-1) torna verdadeiro.';

-- ---------------------------------------------------------------------------
-- DESCARTÁVEIS DE TODA SESSÃO (seringa, agulha, equipo).
--
-- Tabela e não `jsonb`: o épico 6 vai perguntar "quais procedimentos usam
-- esta agulha" quando o fornecedor mudar a caixa, e a trilha de "quem mudou
-- a dose" é por linha.
-- ---------------------------------------------------------------------------
CREATE TABLE insumos_do_procedimento (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id      uuid NOT NULL REFERENCES clinicas(id),
  procedimento_id uuid NOT NULL,
  item_id         uuid NOT NULL,           -- épico 6, sem FK ainda
  milesimos       bigint NOT NULL CHECK (milesimos > 0),
  unidade         text NOT NULL CHECK (length(unidade) BETWEEN 1 AND 20),
  ordem           smallint NOT NULL DEFAULT 0,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT insumos_procedimento_da_clinica
    FOREIGN KEY (procedimento_id, clinica_id) REFERENCES procedimentos (id, clinica_id),
  UNIQUE (procedimento_id, item_id)
);

-- ---------------------------------------------------------------------------
-- PROGRAMAS — o tratamento DE UMA PACIENTE (aba `Adesoes` da v20).
--
-- SEM NENHUM NÚMERO DERIVADO (decisão P-2). O legado guarda `sessoes` (a
-- soma), `plano` (os nomes concatenados), `intervaloDias` (o do primeiro
-- item) e `rotuloSessao`. Todos saem dos itens; guardá-los é criar um segundo
-- número para a mesma pergunta, e o segundo é o que fica errado.
--
-- E nenhuma coluna de dinheiro: o total sai da soma de `itens_do_programa.valor`,
-- o recebido e o saldo saem de `recebimentos` pelo `saldoEmAberto` (regra 5).
-- ---------------------------------------------------------------------------
CREATE TABLE programas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id  uuid NOT NULL REFERENCES clinicas(id),
  paciente_id uuid NOT NULL,
  inicio      date NOT NULL,

  -- `saldo`:  a adesão abriu valor em aberto; cada pagamento abate.
  -- `avulso`: cada sessão registra o que foi pago naquele dia.
  -- Os nomes são os do `Code.gs` e do protótipo, de propósito: eles estão
  -- gravados nas 4 clínicas e o migrador os copia sem traduzir (regra 28).
  modo_de_cobranca text NOT NULL DEFAULT 'avulso' CHECK (modo_de_cobranca IN ('avulso','saldo')),

  situacao            text NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo','encerrado')),
  encerrado_em        timestamptz,
  motivo_encerramento text CHECK (motivo_encerramento IS NULL OR length(motivo_encerramento) <= 260),

  -- O cartão de orçamento que fechou e montou este programa. NULL quando o
  -- programa nasceu por `POST /v1/programas`.
  tarefa_de_origem_id uuid,
  unidade_id          uuid REFERENCES unidades(id),

  excluido_em timestamptz,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  criado_por  uuid REFERENCES pessoas(id),

  CONSTRAINT programas_paciente_da_clinica
    FOREIGN KEY (paciente_id, clinica_id) REFERENCES pacientes (id, clinica_id),
  CONSTRAINT programas_origem_da_clinica
    FOREIGN KEY (tarefa_de_origem_id, clinica_id) REFERENCES tarefas (id, clinica_id),
  CONSTRAINT encerrado_tem_instante CHECK ((situacao = 'encerrado') = (encerrado_em IS NOT NULL)),
  CONSTRAINT programas_id_clinica UNIQUE (id, clinica_id)
);

CREATE INDEX programas_por_paciente ON programas (clinica_id, paciente_id)
  WHERE excluido_em IS NULL;
CREATE INDEX programas_ativos ON programas (clinica_id, situacao)
  WHERE situacao = 'ativo' AND excluido_em IS NULL;
-- Um orçamento fechado monta UM programa. Reenviar o `fechar` não monta o
-- segundo — e o `fechar` já é terminal pela máquina de estados, mas a defesa
-- fica onde nenhum caminho novo (job, migração, correção no psql) a contorna.
CREATE UNIQUE INDEX programa_por_origem ON programas (tarefa_de_origem_id)
  WHERE tarefa_de_origem_id IS NOT NULL AND excluido_em IS NULL;

COMMENT ON TABLE programas IS
  'O tratamento DE UMA PACIENTE (aba `Adesoes` da v20). Sem nenhum número '
  'derivado (P-2): nem sessões, nem saldo, nem valor total, nem o nome.';

-- ---------------------------------------------------------------------------
-- ITENS DO PROGRAMA — um procedimento, com sessões, intervalo, dose e início.
-- ---------------------------------------------------------------------------
CREATE TABLE itens_do_programa (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id  uuid NOT NULL REFERENCES clinicas(id),
  programa_id uuid NOT NULL,
  chave       text NOT NULL CHECK (length(chave) BETWEEN 1 AND 20),

  procedimento_id uuid NOT NULL,
  -- O NOME NO INSTANTE DA MONTAGEM (a lição D-2 do épico 3). Renomear
  -- "Tirzepatida" para "Tirzepatida 5 mg" no catálogo NÃO pode reescrever a
  -- história de quem já está em tratamento. O id agrupa; o nome se lê.
  procedimento_nome text NOT NULL CHECK (length(procedimento_nome) BETWEEN 1 AND 80),
  rotulo_sessao     text NOT NULL CHECK (length(rotulo_sessao) BETWEEN 1 AND 40),

  sessoes        smallint NOT NULL CHECK (sessoes BETWEEN 1 AND 104),
  -- 365 aqui e 180 no catálogo. Não se contradizem: o catálogo é SUGESTÃO, o
  -- item é o caso real. Os dois limites são do protótipo.
  intervalo_dias smallint NOT NULL CHECK (intervalo_dias BETWEEN 1 AND 365),
  -- RESOLVIDO na montagem, nunca derivado em runtime. `depois_de` fica como
  -- registro de COMO foi montado — a reprogramação em cascata o usa.
  inicio         date NOT NULL,
  depois_de      text,

  responsavel_id uuid NOT NULL REFERENCES pessoas(id),
  dose           text NOT NULL DEFAULT '' CHECK (length(dose) <= 60),

  -- O insumo e a dose DESTA paciente, que sobrepõem o padrão do procedimento.
  -- Dado de saúde (regra 18): nunca em log.
  insumo_id        uuid,
  insumo_milesimos bigint CHECK (insumo_milesimos IS NULL OR insumo_milesimos > 0),
  insumo_unidade   text CHECK (insumo_unidade IS NULL OR length(insumo_unidade) BETWEEN 1 AND 20),

  -- O que ESTE item vale, em centavos. A soma dos itens é o total negociado,
  -- EXATAMENTE (`ratearPrograma`). Preço, não receita: não entra em LTV nem
  -- em meta (regra 4).
  valor bigint CHECK (valor IS NULL OR valor >= 0),
  ordem smallint NOT NULL DEFAULT 0,

  criado_em timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT itens_programa_da_clinica
    FOREIGN KEY (programa_id, clinica_id) REFERENCES programas (id, clinica_id),
  CONSTRAINT itens_procedimento_da_clinica
    FOREIGN KEY (procedimento_id, clinica_id) REFERENCES procedimentos (id, clinica_id),
  CONSTRAINT item_nao_depende_de_si CHECK (depois_de IS NULL OR depois_de <> chave),
  CONSTRAINT insumo_tem_unidade CHECK (
    (insumo_id IS NULL) = (insumo_milesimos IS NULL)
    AND (insumo_milesimos IS NULL) = (insumo_unidade IS NULL)),
  UNIQUE (programa_id, chave)
);

CREATE INDEX itens_por_procedimento ON itens_do_programa (clinica_id, procedimento_id);

COMMENT ON COLUMN itens_do_programa.procedimento_nome IS
  'O nome NO INSTANTE DA MONTAGEM (D-2 do épico 3). Renomear no catálogo não '
  'reescreve a história de quem já está em tratamento. O id agrupa.';
COMMENT ON COLUMN itens_do_programa.valor IS
  'Centavos. PREÇO NEGOCIADO, não receita (regra 4). A soma dos itens é o '
  'total negociado, exatamente.';

-- ---------------------------------------------------------------------------
-- A SESSÃO É UMA TAREFA (decisão P-1).
--
-- Quatro razões, e a quarta decide: uma sessão tem responsável, prazo, hora,
-- observação, pode ser cancelada sozinha e carregar o pagamento embutido; a
-- reprogramação é o caso NORMAL; o épico 2 já materializa a série recorrente;
-- e as 4 clínicas já têm linhas de `Tarefas` com `adesaoId` e `sessao = "5/12"`
-- reprogramadas e canceladas à mão. Derivar obrigaria o migrador a inventar
-- parâmetros que o dado não tem, e a regra 28 reprova a clínica inteira por
-- UMA paciente divergente.
-- ---------------------------------------------------------------------------
ALTER TABLE tarefas
  ADD COLUMN programa_id     uuid,
  ADD COLUMN item_chave      text CHECK (item_chave IS NULL OR length(item_chave) BETWEEN 1 AND 20),
  ADD COLUMN sessao_indice   smallint,
  ADD COLUMN sessao_total    smallint,
  -- "Qual procedimento?" na tarefa avulsa de Procedimento realizado. O épico
  -- 6 dá baixa dos insumos padrão por este campo (MANUAL cap. 8).
  ADD COLUMN procedimento_id uuid;

ALTER TABLE tarefas ADD CONSTRAINT tarefas_programa_da_clinica
  FOREIGN KEY (programa_id, clinica_id) REFERENCES programas (id, clinica_id);
ALTER TABLE tarefas ADD CONSTRAINT tarefas_procedimento_da_clinica
  FOREIGN KEY (procedimento_id, clinica_id) REFERENCES procedimentos (id, clinica_id);

-- Toda sessão é de um item de um programa, e é numerada.
ALTER TABLE tarefas ADD CONSTRAINT sessao_e_do_programa CHECK (
  tipo <> 'Sessão de plano' OR (
    programa_id IS NOT NULL AND item_chave IS NOT NULL
    AND sessao_indice IS NOT NULL AND sessao_total IS NOT NULL
    AND sessao_indice BETWEEN 1 AND sessao_total));

-- E SÓ sessão é numerada: um Follow-up com `sessao_indice` é dado que nenhuma
-- consulta sabe ler, e que só se descobre quando a conta não bate.
ALTER TABLE tarefas ADD CONSTRAINT numeracao_so_em_sessao CHECK (
  tipo = 'Sessão de plano'
  OR (sessao_indice IS NULL AND sessao_total IS NULL));

-- `item_chave` também aparece no CONTATO DE RETORNO (ele é de um item), então
-- não se amarra a `tipo`; amarra-se ao programa.
ALTER TABLE tarefas ADD CONSTRAINT item_chave_tem_programa CHECK (
  item_chave IS NULL OR programa_id IS NOT NULL);

-- DUAS SESSÕES 5/12 NO MESMO ITEM tornam a reprogramação ambígua: ela usa o
-- índice para saber o que vem depois. Parcial em `excluida_em` para que a
-- sessão excluída libere o número.
CREATE UNIQUE INDEX sessao_unica_no_item
  ON tarefas (programa_id, item_chave, sessao_indice)
  WHERE tipo = 'Sessão de plano' AND excluida_em IS NULL;

CREATE INDEX tarefas_do_programa ON tarefas (clinica_id, programa_id, prazo)
  WHERE programa_id IS NOT NULL AND excluida_em IS NULL;
-- A agenda da enfermagem: sessões abertas, da mais atrasada para a frente.
-- Parcial, então cresce com o que está PENDENTE, não com o histórico.
CREATE INDEX sessoes_abertas ON tarefas (clinica_id, prazo, responsavel_id)
  WHERE tipo = 'Sessão de plano' AND status = 'aberta' AND excluida_em IS NULL;

COMMENT ON COLUMN tarefas.sessao_indice IS
  'A numeração é DENTRO DO ITEM, não do programa: "Aplicação 1/4 · 5 mg", '
  'nunca "Aplicação 5/8". É o rótulo que a enfermagem lê no frasco.';

-- ---------------------------------------------------------------------------
-- O RECEBIMENTO SABE DE QUE PROGRAMA É.
--
-- É só isto que falta para o agrupamento do épico 4 deixar de ser um grupo
-- só. O contrato e a função `saldoEmAberto` NÃO MUDAM — o `SELECT` do
-- repositório passa a projetar a coluna no lugar de `NULL`.
-- ---------------------------------------------------------------------------
ALTER TABLE recebimentos ADD COLUMN programa_id uuid;
ALTER TABLE recebimentos ADD CONSTRAINT recebimentos_programa_da_clinica
  FOREIGN KEY (programa_id, clinica_id) REFERENCES programas (id, clinica_id);
CREATE INDEX recebimentos_por_programa ON recebimentos (clinica_id, programa_id)
  WHERE programa_id IS NOT NULL AND estornado_em IS NULL;

COMMENT ON COLUMN recebimentos.programa_id IS
  'O grupo do saldo em aberto (regra 5). NULL = grupo geral. Nunca um saldo '
  'gravado: o saldo continua DERIVADO de aberto − abatido.';

-- ---------------------------------------------------------------------------
-- RLS, trilha e privilégio nas quatro tabelas novas.
--
-- `ENABLE` mais `FORCE`: sem o `FORCE`, o dono da tabela escapa da política e
-- um papel que venha a ser dono enxerga todas as clínicas.
-- ---------------------------------------------------------------------------
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['procedimentos','insumos_do_procedimento','programas','itens_do_programa'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (clinica_id = app_clinica_id()) '
      'WITH CHECK (clinica_id = app_clinica_id())', t || '_por_clinica', t);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION registrar_auditoria()', t || '_auditoria', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO fir_app', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- OS CINCO MODELOS, por TRIGGER em `clinicas` — não por TypeScript.
--
-- A lição medida no épico 3: não existe rota que crie clínica. Os testes, a
-- semente e o épico 9 criam clínica por INSERT cru, e uma semeadura em
-- TypeScript deixaria todas elas com o catálogo vazio — e catálogo vazio é
-- "Nova adesão" sem um procedimento para escolher.
--
-- Nomes, sessões, intervalo, rótulo, retorno e antecedência vêm de
-- `MODELOS_PLANOS` (Code.gs:90). NÃO INVENTE OUTROS: é o catálogo que as 4
-- clínicas receberam, e o migrador do épico 9 reconcilia por `nome_chave`.
-- ---------------------------------------------------------------------------
CREATE FUNCTION procedimentos_padrao()
  RETURNS TABLE (nome text, sessoes smallint, intervalo smallint, rotulo text,
                 retorno smallint, unidade text, antecedencia smallint)
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT * FROM (VALUES
      ('Tirzepatida',                12::smallint,  7::smallint, 'Aplicação',   NULL::smallint, 'm', 15::smallint),
      ('Semaglutida',                 8::smallint,  7::smallint, 'Aplicação',   NULL::smallint, 'm', 15::smallint),
      ('Bioestimulador de colágeno',  3::smallint, 30::smallint, 'Sessão',        12::smallint, 'm', 30::smallint),
      ('Toxina botulínica',           1::smallint,  7::smallint, 'Aplicação',      4::smallint, 'm', 15::smallint),
      ('Implante hormonal',           1::smallint,  7::smallint, 'Procedimento',   6::smallint, 'm', 20::smallint))
    AS p(nome, sessoes, intervalo, rotulo, retorno, unidade, antecedencia)
  $$;

CREATE FUNCTION semear_procedimentos() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  -- `SECURITY DEFINER`: roda como `fir_migrate`, que tem BYPASSRLS. Sem isso,
  -- uma clínica criada por `fir_app` (o épico 12) teria a semeadura recusada
  -- pela própria policy de `procedimentos`.
  INSERT INTO public.procedimentos
    (clinica_id, nome, sessoes_sugeridas, intervalo_sugerido_dias, rotulo_sessao,
     retorno_quantidade, retorno_unidade, retorno_antecedencia_dias)
  SELECT NEW.id, p.nome, p.sessoes, p.intervalo, p.rotulo, p.retorno, p.unidade, p.antecedencia
    FROM public.procedimentos_padrao() p;
  RETURN NULL;
END $$;

CREATE TRIGGER clinicas_semeia_procedimentos AFTER INSERT ON clinicas
  FOR EACH ROW EXECUTE FUNCTION semear_procedimentos();

-- E as clínicas que JÁ EXISTEM neste banco. `NOT EXISTS` por `nome_chave`,
-- não `INSERT` cego: se o épico 9 já tiver migrado uma das 4, o nome dela
-- colidiria com `procedimentos_nome_unico` e a migration não aplicaria.
INSERT INTO procedimentos
  (clinica_id, nome, sessoes_sugeridas, intervalo_sugerido_dias, rotulo_sessao,
   retorno_quantidade, retorno_unidade, retorno_antecedencia_dias)
SELECT c.id, p.nome, p.sessoes, p.intervalo, p.rotulo, p.retorno, p.unidade, p.antecedencia
  FROM clinicas c, procedimentos_padrao() p
 WHERE NOT EXISTS (
   SELECT 1 FROM procedimentos x
    WHERE x.clinica_id = c.id AND x.nome_chave = normalizar_nome(p.nome)
      AND x.ativo AND x.excluido_em IS NULL);

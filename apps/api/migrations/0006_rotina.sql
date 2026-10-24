-- ---------------------------------------------------------------------------
-- O NÚCLEO DA ROTINA: pacientes, tarefas e recebimentos.
--
-- A decisão que esta migration fixa, e que o épico inteiro existe para
-- sustentar: `tarefas` NÃO TEM NENHUMA COLUNA DE DINHEIRO. O legado tem
-- `valor`, `valor_aberto` e `forma_pagamento` ali, e é exatamente por isso
-- que a receita do mês dobra quando alguém lança o recebimento avulso do
-- mesmo atendimento — duas linhas, o mesmo dinheiro, nenhum erro.
--
-- Aqui o dinheiro mora em `recebimentos`, e um atendimento guarda NO MÁXIMO
-- UM recebimento vivo. Isso é um índice único parcial, não uma convenção:
-- a migração das 4 clínicas, um job de fila e um `psql` às duas da manhã
-- escrevem pelo mesmo caminho do handler, e só o banco alcança os três.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- A MESMA normalização de nome do legado (`normalizar()` em Code.gs e
-- `norm()` no protótipo), agora IMMUTABLE — e por isso indexável.
--
-- Por que no banco e não na aplicação: a checagem "já existe paciente com
-- esse nome" feita em TypeScript é ler-depois-escrever, e duas recepcionistas
-- cadastrando a mesma paciente ao mesmo tempo criam as duas. Com índice
-- único, a segunda recebe erro. Com `if`, a clínica recebe uma paciente
-- duplicada e descobre no fechamento do mês, quando o LTV dela está partido
-- em dois.
--
-- `search_path` fixo e `pg_catalog` qualificando as funções: a função entra
-- numa expressão de índice, e uma função IMMUTABLE cujo resultado dependesse
-- do `search_path` de quem escreve produziria índice inconsistente com a
-- tabela — o tipo de corrupção que só aparece quando a consulta deixa de
-- achar uma linha que está lá.
-- ---------------------------------------------------------------------------
CREATE FUNCTION normalizar_nome(texto text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  SET search_path = pg_catalog
  AS $$
  SELECT regexp_replace(
           lower(translate(btrim(texto),
             'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
             'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
           '\s+', ' ', 'g')
$$;

COMMENT ON FUNCTION normalizar_nome(text) IS
  'Minúsculas, sem acento, espaços colapsados. É a chave de deduplicação de '
  'nome de paciente e de unidade — a mesma do legado, agora indexável.';

-- ---------------------------------------------------------------------------
-- UNIDADES
--
-- O plano de administração da clínica é o dono desta tabela (migration
-- `0005`), e ela ainda não existe nesta árvore — mas `pacientes` e `tarefas`
-- referenciam `unidade_id`, e uma FK não espera. Então ela nasce aqui, na
-- forma COMPLETA (com `endereco` e `nome_chave`, os dois acertos que aquele
-- plano registrou depois de escrito), e de modo IDEMPOTENTE: se a `0005`
-- tiver sido aplicada antes, nada aqui a toca.
--
-- Quem for implementar a `0005` precisa saber: `unidades` já existe. Veja a
-- nota no plano de admin — lá a tabela sai, e sobra `convites`.
--
-- `UNIQUE (clinica_id, nome)` cru está ERRADO, e por isso não é o que fica:
-- o protótipo e o `Code.gs` comparam o nome NORMALIZADO, então "Unidade
-- Pituba" e "unidade pituba" passariam como duas unidades — e aí a recepção
-- tem duas, com metade do caixa em cada.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS unidades (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES clinicas(id),
  nome       text NOT NULL CHECK (length(nome) BETWEEN 1 AND 80),
  ativa      boolean NOT NULL DEFAULT true,
  criada_em  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE unidades ADD COLUMN IF NOT EXISTS endereco text NOT NULL DEFAULT '';
ALTER TABLE unidades DROP CONSTRAINT IF EXISTS unidades_endereco_cabe;
ALTER TABLE unidades ADD CONSTRAINT unidades_endereco_cabe CHECK (length(endereco) <= 160);

ALTER TABLE unidades ADD COLUMN IF NOT EXISTS nome_chave text
  GENERATED ALWAYS AS (normalizar_nome(nome)) STORED;
ALTER TABLE unidades DROP CONSTRAINT IF EXISTS unidades_clinica_id_nome_key;
CREATE UNIQUE INDEX IF NOT EXISTS unidades_nome_unico ON unidades (clinica_id, nome_chave);

-- ---------------------------------------------------------------------------
-- PACIENTES
-- ---------------------------------------------------------------------------
CREATE TABLE pacientes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id      uuid NOT NULL REFERENCES clinicas(id),
  nome            text NOT NULL CHECK (length(nome) BETWEEN 1 AND 120),
  nome_chave      text GENERATED ALWAYS AS (normalizar_nome(nome)) STORED,
  telefone        text NOT NULL DEFAULT '' CHECK (length(telefone) <= 30),
  -- Só os dígitos: é por eles que a importação deduplica (regra 26). Vazio
  -- vira NULL para que o índice parcial não junte todo mundo sem telefone.
  telefone_chave  text GENERATED ALWAYS AS
                    (nullif(regexp_replace(telefone, '\D', '', 'g'), '')) STORED,
  aniversario     date,
  origem          text NOT NULL DEFAULT '' CHECK (length(origem) <= 60),
  indicado_por    text NOT NULL DEFAULT '' CHECK (length(indicado_por) <= 80),
  unidade_id      uuid REFERENCES unidades(id),
  -- Para quem já era atendido antes da ferramenta (MANUAL cap. 7).
  ultima_consulta date,
  obs             text NOT NULL DEFAULT '' CHECK (length(obs) <= 300),
  -- Estado, nunca exclusão (regra 20). Ver docs/adr/0003.
  ativo           boolean NOT NULL DEFAULT true,
  desativado_em   timestamptz,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  criado_por      uuid REFERENCES pessoas(id),
  CONSTRAINT desativado_tem_instante CHECK ((NOT ativo) = (desativado_em IS NOT NULL))
);

-- Parcial em `ativo`: paciente desativado não ocupa o nome. Quem foi apagado
-- por engano e é recadastrado não deve esbarrar num registro que sumiu da tela.
CREATE UNIQUE INDEX pacientes_nome_unico ON pacientes (clinica_id, nome_chave) WHERE ativo;
CREATE INDEX pacientes_por_telefone ON pacientes (clinica_id, telefone_chave)
  WHERE telefone_chave IS NOT NULL;
CREATE INDEX pacientes_aniversario ON pacientes
  (clinica_id, (extract(month FROM aniversario)), (extract(day FROM aniversario)))
  WHERE aniversario IS NOT NULL AND ativo;

-- ---------------------------------------------------------------------------
-- TAREFAS
-- ---------------------------------------------------------------------------
CREATE TYPE status_de_tarefa AS ENUM ('aberta', 'concluida', 'cancelada');

-- As etapas da Jornada. As TRANSIÇÕES são do épico 3 (`moverEtapa`); aqui
-- nascem só as duas que `criarTarefa` e `concluir` já fazem na v20:
-- agendado, e agendado → realizado ao concluir.
CREATE TYPE etapa_de_jornada AS ENUM
  ('agendado','confirmado','realizado','faltou','desmarcou','orcamento','fechado','perdido','encerrado');

CREATE TABLE tarefas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id     uuid NOT NULL REFERENCES clinicas(id),
  solicitante_id uuid NOT NULL REFERENCES pessoas(id),
  responsavel_id uuid NOT NULL REFERENCES pessoas(id),
  descricao      text NOT NULL CHECK (length(descricao) BETWEEN 1 AND 400),

  -- `date`, NÃO `timestamptz`. O prazo é um dia no CALENDÁRIO da clínica, e
  -- um instante o faria pular de dia conforme o fuso de quem lê. O único
  -- instante desta tabela é `concluida_em` (regra 22/23).
  prazo          date NOT NULL,
  hora           time,

  prioridade     text NOT NULL DEFAULT 'normal' CHECK (prioridade IN ('normal','urgente')),
  status         status_de_tarefa NOT NULL DEFAULT 'aberta',
  concluida_em   timestamptz,

  paciente_id    uuid REFERENCES pacientes(id),
  -- `text` e não ENUM: o dado migrado tem nomes de três gerações
  -- ("Orçamento fechado", "Agendamento"), e `TIPO_ANTIGO` os traduz na
  -- leitura. Um ENUM aqui recusaria a migração das 4 clínicas.
  tipo           text NOT NULL DEFAULT '' CHECK (length(tipo) <= 60),
  etapa          etapa_de_jornada,
  historico      jsonb NOT NULL DEFAULT '[]'::jsonb,

  resultado      text NOT NULL DEFAULT '' CHECK (length(resultado) <= 300),
  obs            text NOT NULL DEFAULT '' CHECK (length(obs) <= 300),
  serie_id       uuid,
  recorrencia    text NOT NULL DEFAULT '' CHECK (length(recorrencia) <= 40),
  unidade_id     uuid REFERENCES unidades(id),

  -- Soft delete (regra 20). A tarefa que alguém excluiu "por engano" às vezes
  -- é a que tinha o pagamento.
  excluida_em    timestamptz,
  criada_em      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tipo_exige_paciente CHECK ((paciente_id IS NULL) = (tipo = '')),
  CONSTRAINT concluida_tem_instante CHECK ((status = 'concluida') = (concluida_em IS NOT NULL))
);

-- A consulta de Hoje e de Tarefas é sempre por clínica + janela de prazo.
CREATE INDEX tarefas_por_prazo ON tarefas (clinica_id, prazo) WHERE excluida_em IS NULL;
CREATE INDEX tarefas_abertas ON tarefas (clinica_id, responsavel_id, prazo)
  WHERE status = 'aberta' AND excluida_em IS NULL;
CREATE INDEX tarefas_por_conclusao ON tarefas (clinica_id, concluida_em DESC)
  WHERE status = 'concluida' AND excluida_em IS NULL;
CREATE INDEX tarefas_por_paciente ON tarefas (clinica_id, paciente_id) WHERE excluida_em IS NULL;
CREATE INDEX tarefas_por_serie ON tarefas (clinica_id, serie_id, prazo) WHERE serie_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RECEBIMENTOS — a regra 3, em forma de tabela
--
-- Nasce aqui, no épico 2, mesmo que a tela de recebimento avulso seja do
-- épico 4. Se nascesse lá, o épico 2 teria guardado dinheiro em `tarefas` e o
-- épico 4 começaria migrando dado financeiro — que é o jeito mais caro
-- possível de descobrir a regra 3.
--
-- A constante `PAGAMENTO_DE` do `Code.gs` existe com o comentário "valores
-- lançados antes da v16 em atendimentos viram um pagamento separado": a
-- própria v20 já concluiu que o valor embutido no atendimento É um pagamento
-- separado. Esta tabela só torna isso explícito no modelo.
-- ---------------------------------------------------------------------------
CREATE TABLE recebimentos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id     uuid NOT NULL REFERENCES clinicas(id),
  paciente_id    uuid NOT NULL REFERENCES pacientes(id),
  -- A tarefa de onde este dinheiro veio. Sempre preenchida no épico 2 (o
  -- pagamento embutido no atendimento). O avulso do épico 4 cria a tarefa
  -- companheira e aponta para ela — a ficha do paciente é UMA linha do tempo.
  tarefa_id      uuid REFERENCES tarefas(id),
  tipo           text NOT NULL CHECK (length(tipo) BETWEEN 1 AND 60),

  -- Centavos. Regra 1. Nunca numeric, nunca float.
  valor          bigint NOT NULL CHECK (valor > 0),
  forma          text NOT NULL CHECK (forma IN
                   ('Pix','Dinheiro','Cartão de crédito','Cartão de débito','Nota promissória')),
  -- O que ESTE pagamento deixou em aberto. É um fato imutável do evento, não
  -- um saldo corrente: o saldo do paciente continua DERIVADO (regra 5),
  -- somando os `valor_aberto` que abriram e subtraindo os recebimentos que
  -- abateram, agrupado por programa.
  valor_aberto   bigint NOT NULL DEFAULT 0 CHECK (valor_aberto >= 0),

  recebido_em    timestamptz NOT NULL,
  unidade_id     uuid REFERENCES unidades(id),
  registrado_por uuid NOT NULL REFERENCES pessoas(id),
  -- Desfazer é estornar, nunca DELETE (regra 20).
  estornado_em   timestamptz,
  criado_em      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- A REGRA 3, EM UMA LINHA.
--
-- Um atendimento guarda NO MÁXIMO UM recebimento VIVO. Não é convenção, não é
-- revisão de código, não é um `if` no serviço: é o banco recusando.
--
-- As duas metades do `WHERE`, e por que cada uma:
--
--   `tarefa_id IS NOT NULL` — o recebimento AVULSO do épico 4 não pende de
--   tarefa, e dois avulsos para a mesma paciente são dois pagamentos de
--   verdade. Sem esta metade, o índice os trataria como duplicação (no
--   Postgres, NULLs não colidem num índice único comum — mas a intenção
--   precisa estar escrita, e um `NULLS NOT DISTINCT` futuro mudaria o
--   comportamento em silêncio).
--
--   `estornado_em IS NULL` — REABRIR um atendimento estorna o recebimento e
--   precisa permitir um novo. Sem esta metade, uma consulta reaberta jamais
--   voltaria a aceitar pagamento, e a recepção acabaria criando uma tarefa
--   duplicada para lançar o dinheiro — que é a própria duplicação que o
--   índice existe para impedir.
--
-- O estorno abre UMA vaga, não desliga a regra: dois recebimentos vivos na
-- mesma tarefa continuam impossíveis depois de qualquer número de estornos.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX recebimento_por_tarefa ON recebimentos (tarefa_id)
  WHERE tarefa_id IS NOT NULL AND estornado_em IS NULL;

CREATE INDEX recebimentos_por_data ON recebimentos (clinica_id, recebido_em DESC)
  WHERE estornado_em IS NULL;
CREATE INDEX recebimentos_por_paciente ON recebimentos (clinica_id, paciente_id)
  WHERE estornado_em IS NULL;

-- ---------------------------------------------------------------------------
-- RLS e trilha, nas quatro.
--
-- `DROP ... IF EXISTS` antes de criar porque `unidades` pode já ter vindo da
-- `0005`: reaplicar a policy é inofensivo, duplicá-la não compila.
--
-- A trilha é obrigatória em toda tabela com `clinica_id` —
-- `teste/auditoria-inescapavel.test.ts` varre o catálogo e reprova quem não
-- tiver. Ninguém chama `registrar()` à mão: o banco faz.
-- ---------------------------------------------------------------------------
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['unidades','pacientes','tarefas','recebimentos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_por_clinica', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (clinica_id = app_clinica_id()) '
      'WITH CHECK (clinica_id = app_clinica_id())', t || '_por_clinica', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_auditoria', t);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION registrar_auditoria()', t || '_auditoria', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO fir_app', t);
  END LOOP;
END $$;

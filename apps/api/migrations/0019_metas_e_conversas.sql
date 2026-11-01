-- ---------------------------------------------------------------------------
-- AS METAS DO MÊS E AS CONVERSAS 1:1 — a segunda metade do épico 7.
--
-- Fecha `meta`, `excluirMeta`, `copiarMetas`, `realizado` e `conversa`, e dá
-- lugar aos 8 indicadores automáticos — que **não têm coluna nenhuma aqui**,
-- e isso é a primeira decisão desta migration.
--
-- Cinco decisões que esta migration fixa:
--
--  1. **NENHUM REALIZADO AUTOMÁTICO É GRAVADO** (regra 11). `agendamentos`,
--     `confirmacoes`, `contatos`, `orc_qtd`, `orc_valor`, `recebimentos`,
--     `tarefas_prazo` e `contagens_prazo` são CONTAGENS derivadas de
--     `tarefas`, `recebimentos` e `contagens_de_estoque`. A única coluna de
--     resultado é `realizado_lancado`, e ela só vale para o indicador
--     `manual`, cobrada por `CHECK` — o protótipo guarda `realizado` em TODA
--     meta e o `realizadoMeta` dele ignora o campo nas automáticas, de modo
--     que a coluna fica lá, gravável pela API, lida por ninguém. Um segundo
--     número para a mesma pergunta é o que a regra 11 fecha, e o segundo é o
--     que fica errado.
--
--  2. **A META É DA FICHA, NÃO DA PESSOA.** `ficha_id`, não `pessoa_id`: a
--     meta é RH (chave `pessoas.gerir`), e a faxineira sem login tem ficha.
--     Quem a liga aos registros da ferramenta é `fichas_de_pessoa.pessoa_id`,
--     e é por isso que uma ficha sem usuário recebe `—` em toda meta
--     automática em vez de zero (medido no protótipo: `if (!uid) return
--     null`).
--
--  3. **UMA META POR (FICHA, MÊS, INDICADOR, NOME), POR ÍNDICE.** É o que
--     torna `copiarMetas` idempotente SEM leitura-antes-de-escrita: o
--     protótipo faz `if (!P.metas.some(...)) push`, que perde a corrida entre
--     duas abas e deixa a pessoa com duas vezes "Agendamentos feitos" no mês
--     — e aí a média de atingimento dela conta a mesma meta duas vezes. Com o
--     índice, a segunda cópia é `ON CONFLICT DO NOTHING` e `copiadas` sai 0.
--     E o `meta` direto, que no protótipo aceita duplicata sem conferir
--     nada, passa a ser 409 com o nome do indicador na mensagem.
--
--  4. **O ALVO É UM INTEIRO, E A ESCALA VEM DO INDICADOR.** `qtd` é unidade,
--     `pct` é ponto percentual (0–100), `valor` é CENTAVOS (regra 1). Uma
--     coluna só, com a escala declarada pelo indicador — como
--     `movimentos_de_estoque.quantidade`, que é sempre em `medida` porque o
--     item declara a conversão. Duas colunas (`alvo_centavos` e `alvo_numero`)
--     seriam duas representações do mesmo fato, e a divergência aparece no dia
--     em que alguém preenche a errada. O `CHECK` cobra o teto de `pct`.
--
--  5. **A CONVERSA 1:1 É APPEND-ONLY NA PRÁTICA, E SOFT DELETE NO ESQUEMA.**
--     Ela é o registro de uma conversa que aconteceu — "pontos fortes, a
--     desenvolver e combinados" (MANUAL cap. 13). Não há rota de edição: o que
--     foi dito em outubro não se reescreve em dezembro. Excluir existe para o
--     lançamento feito na pessoa errada, e é soft delete (regra 20).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- AS METAS DO MÊS
-- ---------------------------------------------------------------------------
CREATE TABLE metas_de_pessoa (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES clinicas(id),
  ficha_id   uuid NOT NULL,

  -- `aaaa-mm`, pela mesma razão de `banco_de_horas.mes`: o mês É a
  -- granularidade, e um `date` com dia 1º convidaria dois lançamentos no mesmo
  -- mês com dias diferentes.
  mes text NOT NULL CHECK (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),

  -- As nove chaves de `INDICADORES`, em `packages/domain/metas-de-pessoa.ts`.
  -- `CHECK` e não `enum` de Postgres: acrescentar valor a um enum não volta
  -- atrás numa migration forward-only.
  indicador text NOT NULL CHECK (indicador IN (
    'agendamentos', 'confirmacoes', 'contatos', 'orc_qtd', 'orc_valor',
    'recebimentos', 'tarefas_prazo', 'contagens_prazo', 'manual')),

  -- O nome que a gestora deu à meta MANUAL ("Avaliações 5 estrelas no
  -- Google"). Vazio nas automáticas, onde o nome vem da tabela do domínio —
  -- gravá-lo seria a segunda cópia de um rótulo que a tela já sabe.
  nome text NOT NULL DEFAULT '' CHECK (length(nome) <= 60),

  -- O ALVO, inteiro, na escala do indicador (decisão 4). `bigint` porque
  -- `orc_valor` é em centavos e um orçamento de R$ 20 milhões em meta anual
  -- não cabe em `integer` de centavos com folga confortável.
  alvo bigint NOT NULL CHECK (alvo > 0),

  -- O resultado LANÇADO À MÃO. Só a meta `manual` o tem (decisão 1).
  -- `NULL` é "ainda não lançado" e aparece como `—`; zero é um resultado
  -- declarado como zero, e os dois NÃO são a mesma coisa (medido: o protótipo
  -- devolve `0` para `realizado: 0` e `null` para `realizado: ''`).
  realizado_lancado bigint CHECK (realizado_lancado IS NULL OR realizado_lancado >= 0),

  excluida_em timestamptz,
  criada_em   timestamptz NOT NULL DEFAULT now(),
  criada_por  uuid REFERENCES pessoas(id),

  -- A META AUTOMÁTICA NÃO TEM RESULTADO LANÇADO. É a decisão 1 com dentes:
  -- sem este `CHECK`, a rota `realizado` do protótipo gravaria um número em
  -- `agendamentos` que a leitura ignora, e a gestora acharia que lançou.
  CONSTRAINT realizado_lancado_so_na_manual
    CHECK (realizado_lancado IS NULL OR indicador = 'manual'),
  -- NOME OBRIGATÓRIO NA MANUAL, PROIBIDO NAS OUTRAS. "Outra meta" sem nome é
  -- uma linha que a tela não sabe rotular; nome numa automática é um segundo
  -- rótulo para o mesmo indicador, e os dois divergem na primeira renomeação.
  CONSTRAINT nome_combina_com_indicador
    CHECK ((indicador = 'manual') = (btrim(nome) <> '')),
  -- `pct` é ponto percentual: uma meta de "150% das tarefas no prazo" não é
  -- ambiciosa, é erro de digitação — e ela deixaria o atingimento preso em 67%
  -- para sempre.
  CONSTRAINT alvo_percentual_cabe_em_cem
    CHECK (indicador NOT IN ('tarefas_prazo', 'contagens_prazo') OR alvo <= 100),
  CONSTRAINT meta_e_da_clinica
    FOREIGN KEY (clinica_id, ficha_id) REFERENCES fichas_de_pessoa (clinica_id, id)
);

/**
 * UMA META POR (FICHA, MÊS, INDICADOR, NOME) — a decisão 3.
 *
 * `nome` entra na chave para que duas metas MANUAIS com nomes diferentes
 * convivam ("Avaliações no Google" e "Indicações trazidas"), e duas com o
 * mesmo nome não. Nas automáticas `nome` é `''` por `CHECK`, então a chave
 * colapsa em (ficha, mês, indicador), que é exatamente o que ela precisa ser.
 *
 * Parcial em `excluida_em IS NULL`: a meta removida por engano libera a chave
 * para ser criada de novo, como `ficha_por_usuario` na 0018.
 */
CREATE UNIQUE INDEX meta_por_ficha_mes_indicador
  ON metas_de_pessoa (clinica_id, ficha_id, mes, indicador, nome)
  WHERE excluida_em IS NULL;

CREATE INDEX metas_do_mes_da_clinica ON metas_de_pessoa (clinica_id, mes)
  WHERE excluida_em IS NULL;

COMMENT ON TABLE metas_de_pessoa IS
  'As metas do mês por ficha. NÃO guarda realizado automático: os 8 '
  'indicadores de IND_PES são contagens derivadas (regra 11). A única coluna '
  'de resultado é `realizado_lancado`, e o CHECK a restringe ao indicador '
  '`manual`.';

COMMENT ON COLUMN metas_de_pessoa.alvo IS
  'Inteiro na escala do INDICADOR: unidade para `qtd`, ponto percentual para '
  '`pct`, CENTAVOS para `orc_valor` (regra 1). Quem declara a escala é o '
  'indicador, como o item declara a conversão do movimento de estoque.';

-- ---------------------------------------------------------------------------
-- AS CONVERSAS 1:1
--
-- "Uma conversa por mês com cada pessoa. O registro mostra as metas do mês e
-- guarda pontos fortes, pontos a desenvolver e combinados. Cada combinado pode
-- virar tarefa para a pessoa, com prazo de 30 dias" (MANUAL cap. 13).
-- ---------------------------------------------------------------------------
CREATE TABLE conversas_1a1 (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES clinicas(id),
  ficha_id   uuid NOT NULL,

  -- O dia em que a conversa ACONTECEU, no fuso da clínica (regra 22). Dia
  -- civil, não instante: ninguém pergunta a que horas foi a 1:1.
  data date NOT NULL,
  -- O mês A QUE ELA SE REFERE, que não é o mês em que ela aconteceu — a
  -- conversa de outubro acontece em 3 de novembro, e é com as metas de outubro
  -- que ela se compara. Dois campos porque são dois fatos.
  mes  text NOT NULL CHECK (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),

  -- Quem conduziu. `Pessoa` (quem usa a ferramenta), não ficha: é o `me.id`
  -- dela, e é a mesma coisa que `fichas_de_pessoa.gestor_id` referencia.
  por_id uuid NOT NULL REFERENCES pessoas(id),

  -- Os três blocos, texto livre com uma linha por item. O servidor os devolve
  -- já quebrados em lista — a tela não faz `split`, pela mesma razão que não
  -- calcula período aquisitivo.
  --
  -- **Isto é avaliação de desempenho de uma funcionária identificada**, e por
  -- isso nunca vai para log (regra 21) e a leitura fica na trilha.
  fortes      text NOT NULL DEFAULT '' CHECK (length(fortes) <= 1500),
  desenvolver text NOT NULL DEFAULT '' CHECK (length(desenvolver) <= 1500),
  combinados  text NOT NULL DEFAULT '' CHECK (length(combinados) <= 1500),

  excluida_em timestamptz,
  criada_em   timestamptz NOT NULL DEFAULT now(),

  -- CONVERSA VAZIA NÃO É CONVERSA. O protótipo cobra isso na TELA
  -- (`if (!dados.fortes && !dados.desenvolver && !dados.combinados)`), o que
  -- deixa a API aceitando um registro que diz "a 1:1 de outubro aconteceu" e
  -- não guarda nada dela — pior que a ausência, porque cala o aviso de
  -- pendente.
  CONSTRAINT conversa_tem_conteudo
    CHECK (btrim(fortes) <> '' OR btrim(desenvolver) <> '' OR btrim(combinados) <> ''),
  CONSTRAINT conversa_e_da_clinica
    FOREIGN KEY (clinica_id, ficha_id) REFERENCES fichas_de_pessoa (clinica_id, id)
);

/**
 * Sem índice ÚNICO por (ficha, mês), e isso é deliberado.
 *
 * A tela diz "uma conversa por mês com cada pessoa", e esse é o RITUAL — não
 * um invariante de dado. Duas conversas no mesmo mês de referência acontecem
 * de verdade: a 1:1 normal e a conversa de correção duas semanas depois.
 * Recusar a segunda obrigaria a gestora a apagar a primeira, que é justamente
 * o registro que a trilha de RH precisa manter.
 *
 * O que a lista "pendentes deste mês" usa é `NOT EXISTS`, e ela funciona igual
 * com uma ou com duas.
 */
CREATE INDEX conversas_da_ficha ON conversas_1a1 (clinica_id, ficha_id, data DESC)
  WHERE excluida_em IS NULL;
CREATE INDEX conversas_do_mes ON conversas_1a1 (clinica_id, mes)
  WHERE excluida_em IS NULL;

COMMENT ON TABLE conversas_1a1 IS
  'O registro da conversa 1:1. Avaliação de desempenho de pessoa '
  'identificada: nunca em log (regra 21), leitura na trilha. Não há rota de '
  'edição — o que foi dito em outubro não se reescreve em dezembro.';

-- ---------------------------------------------------------------------------
-- RLS + TRILHA nas duas tabelas novas.
--
-- `ENABLE` mais `FORCE` para que nem o dono escape. A policy filtra por
-- clínica com AND e nada mais — `isolamento-de-clinica.test.ts` recusa
-- qualquer `OR` nela, e `auditoria-inescapavel.test.ts` cobra o trigger em
-- toda relação com `clinica_id`.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['metas_de_pessoa', 'conversas_1a1'] LOOP
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

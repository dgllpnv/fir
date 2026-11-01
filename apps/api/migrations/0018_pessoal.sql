-- ---------------------------------------------------------------------------
-- A FICHA DE PESSOA, OS DOCUMENTOS, AS FÉRIAS E O BANCO DE HORAS.
--
-- Primeira metade do épico 7: `ficha`, `doc`, `excluirDoc`, `ferias`,
-- `excluirFerias`, `horas` e `config` (o `limiteHoras`, não configuração da
-- clínica). Metas, conversas 1:1 e os 8 indicadores vêm na segunda fatia.
--
-- Cinco decisões que esta migration fixa:
--
--  1. **A FICHA NÃO É A PESSOA.** `pessoas` é quem ENTRA (login, perfil,
--     ativação — chave `config`); `fichas_de_pessoa` é quem TRABALHA (RH —
--     chave `pessoas.gerir`). A faxineira sem login tem ficha, e o MANUAL diz
--     isso com estas palavras: *"cada pessoa da clínica tem uma ficha, mesmo
--     quem não usa a ferramenta"* (cap. 13). Uma coluna `salario` em `pessoas`
--     poria salário e permissão na mesma tabela, e a tela de acesso passaria a
--     ter de lembrar de não selecioná-la.
--
--  2. **`salario` É O NOME DA COLUNA, e isso não é estilo.** A redação de
--     valores casa **nome de chave** (`CAMPOS_MONETARIOS`), e `GET
--     /v1/auditoria` devolve `to_jsonb(NEW)` — NOME DE COLUNA, normalizado
--     para camelCase. `remuneracao` ou `valor_salario` atravessariam a trilha
--     inteiros para quem tem `config` e não tem `pessoas.gerir`.
--
--  3. **`saldo_minutos`, INTEIRO** (regra 8). O protótipo guarda hora decimal
--     (`3.5`, `-4.25`) e formata com `Math.floor(a) + Math.round((a%1)*60)`,
--     que em `0,999` imprime `0h60`. Minuto inteiro torna o caso impossível.
--     E o campo da API é `saldoEmMinutos`, nunca `saldo` — `saldo` está em
--     `CAMPOS_MONETARIOS` por causa do saldo em aberto da paciente, e a
--     redação apagaria a tabela toda para quem não tem `valores`. É o mesmo
--     conserto de `saldo` → `saldoEmEstoque` do épico 6.
--
--  4. **PERÍODO DE FÉRIAS NÃO SE SOBREPÕE**, e aqui divergimos do protótipo,
--     que apenas concatena. Dois registros sobrepostos inflam o total abatido,
--     `diasRestantes` encolhe, e a clínica deixa de ser avisada da dívida que
--     tem — na direção que custa férias em dobro (CLT art. 137). Cobrado por
--     `EXCLUDE`, não por `if`: duas abas registrando o mesmo período ao mesmo
--     tempo passariam as duas por uma leitura-antes-de-escrita.
--
--  5. **NENHUM DERIVADO É COLUNA.** Não há `dias_de_ferias`, não há
--     `tempo_de_casa`, não há `periodo_aquisitivo`, não há `quantos_alertas`.
--     Os quatro saem de `packages/domain/pessoal.ts` (regra 11): um número
--     derivado gravado é um segundo número para a mesma pergunta, e o segundo
--     é o que fica errado.
-- ---------------------------------------------------------------------------

-- `btree_gist` é uma extensão CONFIÁVEL (`trusted = true` no `.control` desde
-- o PG 13), então `fir_migrate` a instala sem ser superusuário. Ela existe por
-- um motivo só: o `EXCLUDE` de férias precisa combinar igualdade de `uuid`
-- (btree) com sobreposição de `daterange` (gist) no MESMO índice.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- A COMPOSTA em `pessoas`, pela mesma razão das de `tarefas` e
-- `itens_de_estoque` (0016): sem a clínica junto, a chave estrangeira de
-- `fichas_de_pessoa.pessoa_id` aceitaria o usuário da clínica vizinha e a RLS
-- só esconderia a leitura. Expand puro — nenhuma coluna muda.
ALTER TABLE pessoas ADD CONSTRAINT pessoas_clinica_id_id_key UNIQUE (clinica_id, id);

-- ---------------------------------------------------------------------------
-- A FICHA
-- ---------------------------------------------------------------------------
CREATE TABLE fichas_de_pessoa (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES clinicas(id),

  nome    text NOT NULL CHECK (length(btrim(nome)) BETWEEN 2 AND 80),
  cargo   text NOT NULL DEFAULT '' CHECK (length(cargo) <= 60),

  -- Os cinco de `CONTRATOS`, em `packages/domain/pessoal.ts`. `CHECK` e não
  -- `enum` de Postgres: acrescentar valor a um enum não volta atrás numa
  -- migration forward-only, e a lista é dado de produto, não de esquema.
  contrato text NOT NULL DEFAULT 'CLT'
    CHECK (contrato IN ('CLT', 'PJ', 'Estágio', 'Autônomo', 'Sócia')),

  -- Dias civis no fuso da clínica (regra 22). `admissao` é a ÂNCORA do período
  -- aquisitivo e dos 45/90 dias de experiência: sem ela não há férias a
  -- calcular, e é por isso que ela é nula em vez de ter um padrão inventado.
  admissao    date,
  aniversario date,

  -- CENTAVOS (regra 1), `bigint`, e `NULL` é "não informado" — nunca zero.
  -- Zero é um salário declarado como zero (sócia que retira pró-labore por
  -- fora), e tratar os dois igual apagaria a diferença.
  salario bigint CHECK (salario IS NULL OR salario >= 0),

  -- O `Usuário` da ferramenta ligado a esta ficha. `NULL` = não usa.
  pessoa_id uuid,
  -- O gestor direto, que conduz a 1:1. É uma `Pessoa` (quem usa a ferramenta),
  -- não uma ficha — é a lista `S.team` dela.
  gestor_id uuid REFERENCES pessoas(id),

  ativo         boolean NOT NULL DEFAULT true,
  desativada_em timestamptz,
  -- Soft delete (regra 20). Não há `DELETE` de ficha: o histórico de férias,
  -- documento e banco de horas dela não pode sumir porque alguém saiu.
  excluida_em   timestamptz,

  criada_em  timestamptz NOT NULL DEFAULT now(),
  criada_por uuid REFERENCES pessoas(id),

  CONSTRAINT ficha_desativada_tem_instante CHECK (ativo = (desativada_em IS NULL)),
  -- A COMPOSTA, para os três filhos referenciarem (clinica_id, id) juntos.
  CONSTRAINT fichas_clinica_id_id_key UNIQUE (clinica_id, id),
  CONSTRAINT ficha_pessoa_e_da_clinica
    FOREIGN KEY (clinica_id, pessoa_id) REFERENCES pessoas (clinica_id, id)
);

/**
 * UMA FICHA POR USUÁRIO, e por índice — não por `if` no serviço.
 *
 * "Esse usuário já está ligado a outra ficha", diz ela. O vínculo é o que faz
 * a meta automática saber de quem são os registros (épico 7, segunda fatia):
 * duas fichas apontando para o mesmo login contariam o trabalho dela duas
 * vezes, e a conferência da migração acusaria um número que não existe.
 *
 * Parcial em `excluida_em IS NULL`: a ficha excluída por engano libera o
 * usuário para a ficha nova, como o índice único de `perfis` na 0014.
 */
CREATE UNIQUE INDEX ficha_por_usuario ON fichas_de_pessoa (clinica_id, pessoa_id)
  WHERE pessoa_id IS NOT NULL AND excluida_em IS NULL;

CREATE INDEX fichas_vivas ON fichas_de_pessoa (clinica_id, ativo, nome)
  WHERE excluida_em IS NULL;

COMMENT ON COLUMN fichas_de_pessoa.salario IS
  'Centavos. O nome é `salario` DE PROPÓSITO: é a chave que o '
  'RedacaoInterceptor mapeia para `pessoas.gerir` em vez de `valores`, e '
  'renomeá-la fez o campo atravessar inteiro em GET /v1/auditoria.';

-- ---------------------------------------------------------------------------
-- DOCUMENTOS COM VALIDADE
--
-- "ASO, registro profissional (COREN, CRM), treinamentos. Aviso 30 dias antes
-- de vencer" (MANUAL cap. 13). O VALOR do documento é o alerta: um documento
-- sem validade é aceito e a tela diz que ele não avisa nada.
-- ---------------------------------------------------------------------------
CREATE TABLE documentos_da_pessoa (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES clinicas(id),
  ficha_id   uuid NOT NULL,

  nome     text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 60),
  validade date,

  excluido_em timestamptz,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  criado_por  uuid REFERENCES pessoas(id),

  CONSTRAINT documento_e_da_clinica
    FOREIGN KEY (clinica_id, ficha_id) REFERENCES fichas_de_pessoa (clinica_id, id)
);

CREATE INDEX documentos_da_ficha ON documentos_da_pessoa (clinica_id, ficha_id, validade)
  WHERE excluido_em IS NULL;

-- ---------------------------------------------------------------------------
-- FÉRIAS REGISTRADAS
-- ---------------------------------------------------------------------------
CREATE TABLE ferias_da_pessoa (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES clinicas(id),
  ficha_id   uuid NOT NULL,

  -- Dias civis INCLUSIVOS nas duas pontas: 01→01 é um dia de férias, não zero.
  -- É a convenção dela (`diasEntre(inicio, fim) + 1`), e ela convive com a
  -- regra 23 porque aqui não há instante nenhum — é calendário, não janela.
  inicio date NOT NULL,
  fim    date NOT NULL,

  situacao text NOT NULL DEFAULT 'programada'
    CHECK (situacao IN ('programada', 'gozada')),

  excluida_em timestamptz,
  criada_em   timestamptz NOT NULL DEFAULT now(),
  criada_por  uuid REFERENCES pessoas(id),

  CONSTRAINT ferias_tem_ordem CHECK (fim >= inicio),
  -- Um ano de férias não é férias: é erro de digitação, e sem este teto ele
  -- zeraria `diasRestantes` de todos os períodos de uma vez.
  CONSTRAINT ferias_tem_tamanho_plausivel CHECK (fim - inicio < 365),
  CONSTRAINT ferias_e_da_clinica
    FOREIGN KEY (clinica_id, ficha_id) REFERENCES fichas_de_pessoa (clinica_id, id)
);

/**
 * PERÍODO SOBREPOSTO É RECUSADO PELO BANCO.
 *
 * `daterange(inicio, fim, '[]')` porque as duas pontas são inclusivas. O
 * serviço também confere (`feriasSeSobrepoem`, no domínio) para dar a mensagem
 * de tela — mas é esta restrição que fecha a corrida entre duas abas, que
 * nenhuma leitura-antes-de-escrita fecha.
 */
ALTER TABLE ferias_da_pessoa ADD CONSTRAINT ferias_nao_se_sobrepoem
  EXCLUDE USING gist (
    ficha_id WITH =,
    daterange(inicio, fim, '[]') WITH &&
  ) WHERE (excluida_em IS NULL);

CREATE INDEX ferias_da_ficha ON ferias_da_pessoa (clinica_id, ficha_id, inicio)
  WHERE excluida_em IS NULL;

-- ---------------------------------------------------------------------------
-- BANCO DE HORAS
--
-- "A ferramenta NÃO registra ponto. No fim do mês, lance o saldo de cada
-- pessoa como aparece no aplicativo oficial de ponto" (MANUAL cap. 13).
--
-- Por que MUTÁVEL, e não append-only como `movimentos_de_estoque`: isto é
-- TRANSCRIÇÃO de outro sistema, não livro-razão. A gestora digitou +6:30 onde
-- o app dizia +6:03 e corrige na linha seguinte — e o `de → para` fica na
-- trilha pelo trigger, que é onde a história desta correção pertence.
-- ---------------------------------------------------------------------------
CREATE TABLE banco_de_horas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES clinicas(id),
  ficha_id   uuid NOT NULL,

  -- `aaaa-mm`. Texto e não `date` com dia 1: o mês É a granularidade do dado,
  -- e um `date` convidaria alguém a lançar dois saldos no mesmo mês com dias
  -- diferentes — que é exatamente o que o índice único abaixo impede.
  mes text NOT NULL CHECK (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),

  -- MINUTOS INTEIROS, assinados. `SALDO_MAXIMO_EM_MINUTOS` do domínio é 60000
  -- (±1.000 h): acima disso não é saldo, é erro de digitação.
  saldo_minutos integer NOT NULL CHECK (saldo_minutos BETWEEN -60000 AND 60000),
  obs           text NOT NULL DEFAULT '' CHECK (length(obs) <= 80),

  -- Limpar o campo é soft delete (regra 20), nunca `DELETE`: o protótipo faz
  -- `P.horas.filter(...)` e o lançamento desaparece sem deixar rastro de quem
  -- o apagou.
  excluido_em timestamptz,
  lancado_em  timestamptz NOT NULL DEFAULT now(),
  lancado_por uuid REFERENCES pessoas(id),

  CONSTRAINT horas_e_da_clinica
    FOREIGN KEY (clinica_id, ficha_id) REFERENCES fichas_de_pessoa (clinica_id, id)
);

-- UM SALDO POR PESSOA E POR MÊS. É isto, e não um `if` no serviço, que torna
-- "Salvar saldos de outubro" idempotente: duas abas salvando a mesma tabela
-- têm a segunda recusada ou atualizada pelo `ON CONFLICT`, nunca duplicada.
CREATE UNIQUE INDEX horas_por_ficha_e_mes ON banco_de_horas (clinica_id, ficha_id, mes)
  WHERE excluido_em IS NULL;

COMMENT ON COLUMN banco_de_horas.saldo_minutos IS
  'Minutos inteiros, assinados. O campo da API é `saldoEmMinutos` e NUNCA '
  '`saldo`: `saldo` está em CAMPOS_MONETARIOS e a redação o apagaria.';

-- ---------------------------------------------------------------------------
-- A CONFIGURAÇÃO DE PESSOAL — o `limiteHoras` dela, e só ele.
--
-- Tabela própria, e não uma coluna em `clinicas`: `clinicas` é a raiz do
-- tenancy e NÃO TEM RLS (escopá-la por `app_clinica_id()` seria circular), de
-- modo que uma configuração ali ficaria fora da policy e fora do trigger de
-- trilha. É a mesma razão de `configuracao_financeira` existir (0009).
-- ---------------------------------------------------------------------------
CREATE TABLE configuracao_de_pessoal (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES clinicas(id),

  -- ±10 h é o padrão do protótipo. Em MINUTOS, como todo o módulo — a tela
  -- pergunta em horas e converte, porque converter é formatar.
  limite_de_horas_minutos integer NOT NULL DEFAULT 600
    CHECK (limite_de_horas_minutos BETWEEN 60 AND 12000),

  atualizada_em  timestamptz NOT NULL DEFAULT now(),
  atualizada_por uuid REFERENCES pessoas(id)
);

-- Uma configuração por clínica. Mesmo padrão de `configuracao_financeira`.
CREATE UNIQUE INDEX configuracao_de_pessoal_por_clinica
  ON configuracao_de_pessoal (clinica_id);

-- ---------------------------------------------------------------------------
-- RLS + TRILHA nas cinco tabelas novas.
--
-- `ENABLE` mais `FORCE` para que nem o dono escape. A policy filtra por
-- clínica com AND e nada mais — `isolamento-de-clinica.test.ts` recusa
-- qualquer `OR` nela, e `auditoria-inescapavel.test.ts` cobra o trigger em
-- toda relação com `clinica_id`.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fichas_de_pessoa', 'documentos_da_pessoa',
                           'ferias_da_pessoa', 'banco_de_horas',
                           'configuracao_de_pessoal'] LOOP
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

-- ---------------------------------------------------------------------------
-- ÉPICO 9 — A MIGRAÇÃO DAS CLÍNICAS DA v20.
--
-- Esta migration faz três coisas, e cada uma nasceu de uma medição contra a
-- CÓPIA REAL dos dados das três clínicas, não contra dado de exemplo:
--
--   1. a tabela `origens_da_v20`, que é a IDEMPOTÊNCIA da regra 26 em forma
--      de esquema — não um `if` no serviço;
--   2. o relaxamento de `recebimento_forma_so_com_dinheiro`, porque o dado
--      real das três clínicas refuta a metade dela que ninguém havia medido;
--   3. o perfil `pf_mig`, sem permissão nenhuma, para a pessoa que a v20
--      APAGOU da aba `Equipe` e cujas tarefas continuam apontando para ela.
--
-- Faz DML em tabela de negócio (o perfil é por demanda do migrador, não aqui;
-- mas o `COMMENT` e o `ALTER` não escrevem linha). Declara o ator de todo
-- modo: o custo é zero e a ausência dele é o erro que a 0012 documenta.
-- ---------------------------------------------------------------------------
SELECT set_config('app.pessoa_id', 'sistema', true);

-- ---------------------------------------------------------------------------
-- 1. `origens_da_v20` — A CHAVE DE IDEMPOTÊNCIA (regra 26).
--
-- "Reimportar o mesmo arquivo três vezes não cria nada novo", e é assim que
-- se testa. O mecanismo tem de ser de ESQUEMA e não de serviço, pela mesma
-- razão do `UNIQUE (clinica_id, serie_id, vencimento)` das contas: um `if`
-- perde a corrida entre duas execuções, e a segunda importação de uma clínica
-- de 1.500 tarefas é exatamente o momento em que alguém aperta duas vezes.
--
-- A CHAVE É `(clinica_id, entidade, id_externo)`, e cada parte é necessária:
--
--   `clinica_id` — `novoId()` é gerado por planilha, não globalmente. Duas
--   clínicas têm chance real de compartilhar um id de 8 hex, e sem a clínica
--   na chave a segunda migração "reconheceria" linhas da primeira e as
--   ligaria à paciente errada. É o pior defeito possível desta tabela.
--
--   `entidade` — o id da v20 tem PREFIXO por tipo (`t…`, `u…`, `pl…`), mas
--   **não em todas**: `Pacientes`, `Adesoes` e `Campanhas` usam `novoId()`
--   cru. Um paciente e uma adesão podem colidir, e sem a entidade na chave a
--   adesão viraria "já importada" apontando para a linha de `pacientes`.
--
--   `id_externo` — o `novoId()` da v20, **como está na planilha**. Nunca
--   normalizado: é a chave que o arquivo tem.
--
-- `(tabela, id_interno)` É ÚNICO NO SENTIDO INVERSO: uma linha do destino tem
-- no máximo UMA origem. Sem isso, um erro de reexecução poderia ligar duas
-- linhas da planilha à mesma linha do banco — e a conferência de contagem
-- passaria, porque ela conta as linhas de ORIGEM.
-- ---------------------------------------------------------------------------
CREATE TABLE origens_da_v20 (
  -- `id` e não a chave composta como PK: `registrar_auditoria` grava
  -- `NEW.id` em `entidade_id` (NOT NULL), e
  -- `teste/auditoria-inescapavel.test.ts` varre o catálogo cobrando
  -- exatamente esta convenção. Chave composta deixaria `entidade_id` nulo e
  -- a primeira escrita estouraria em produção.
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id   uuid NOT NULL REFERENCES clinicas(id),
  -- Uma das abas de `ABAS_DE_DADOS`, ou `Recebimento` (que não é aba: é a
  -- linha de `recebimentos` derivada do pagamento embutido na tarefa).
  entidade     text NOT NULL CHECK (length(entidade) BETWEEN 1 AND 40),
  id_externo   text NOT NULL CHECK (length(id_externo) BETWEEN 1 AND 64),
  tabela       text NOT NULL CHECK (length(tabela) BETWEEN 1 AND 63),
  id_interno   uuid NOT NULL,
  importado_em timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT origem_unica_por_id_externo UNIQUE (clinica_id, entidade, id_externo),
  CONSTRAINT origem_unica_por_destino UNIQUE (clinica_id, tabela, id_interno)
);

COMMENT ON TABLE origens_da_v20 IS
  'A chave de idempotência da migração (regra 26): (clinica_id, entidade, '
  'id_externo) → a linha criada. Reimportar o mesmo .xlsx três vezes não cria '
  'nada novo, e é assim que se testa. NÃO é uma tabela de tradução para o '
  'runtime: nenhuma leitura do produto a consulta.';

COMMENT ON COLUMN origens_da_v20.id_externo IS
  'O `novoId()` da v20 — UUID truncado em 8 hex, 32 bits. A COLISÃO é '
  'plausível em dezenas de milhares de linhas, e `colisoesDeId` a detecta e '
  'REPROVA a clínica: duas linhas com o mesmo id já estão ambíguas na ORIGEM, '
  'e nenhuma escolha do migrador é correta.';

-- ---------------------------------------------------------------------------
-- 2. A FORMA DE PAGAMENTO QUE A v20 NÃO REGISTROU.
--
-- A 0011 escreveu:
--
--     CHECK ((valor > 0) = (forma <> ''))
--
-- A metade medida era a de trás: não existe forma de pagamento para dinheiro
-- que não se moveu, e "Pix" num recebimento de R$ 0,00 apareceria como um Pix
-- que ninguém fez. Essa metade FICA.
--
-- A metade da frente — *dinheiro que entrou SEMPRE tem forma* — era uma
-- suposição, e o dado real das três clínicas a refuta:
--
--   * `migrarPagamentos()` (Code.gs:191) converte todo valor lançado antes da
--     v16 em tarefa de pagamento com `formaPagamento: ''` — explicitamente,
--     no código, porque a forma nunca foi perguntada;
--   * a forma só passou a ser pedida na v17, então todo pagamento anterior a
--     ela está no arquivo sem forma.
--
-- Medido: **64 recebimentos** de uma clínica, **1** de cada uma das outras
-- duas, com `valor > 0` e `forma = ''`. A v20 os conta em receita e em LTV.
--
-- AS TRÊS SAÍDAS, E POR QUE ESTA:
--
--   (a) inventar uma forma ("Pix", "Dinheiro") — é inventar dado, e a forma
--       de pagamento é o que a conferência de caixa compara. Recusada.
--   (b) acrescentar uma sexta forma ("Não informado") — ela entraria na
--       lista que a recepção escolhe no balcão TODO DIA, para descrever um
--       fato que só existe no passado. Recusada.
--   (c) aceitar `forma = ''` como "entrou, forma não registrada" — é o que o
--       dado diz, e é o que a v20 já fazia. ESCOLHIDA.
--
-- A CONDIÇÃO SEM A QUAL ESTA ESCOLHA ESTRAGA O CAIXA, e ela não mora nesta
-- migration: `DINHEIRO_QUE_ENTROU` perde a segunda metade (passa a ser só
-- `r.valor > 0`), e a conferência do caixa POR FORMA ganha um filtro próprio
-- (`NA_GAVETA`). Sem essa separação, um pagamento sem forma entraria no
-- esperado do caixa num grupo de nome vazio, e a recepcionista procuraria por
-- uma hora uma diferença que ela não causou — que é literalmente o pior caso
-- descrito em `dinheiro-que-entrou.ts`.
-- ---------------------------------------------------------------------------
ALTER TABLE recebimentos DROP CONSTRAINT recebimento_forma_so_com_dinheiro;

ALTER TABLE recebimentos
  ADD CONSTRAINT recebimento_forma_so_com_dinheiro CHECK (forma = '' OR valor > 0);

COMMENT ON COLUMN recebimentos.forma IS
  'Uma das cinco formas, ou VAZIA. Vazia significa uma de duas coisas, e as '
  'duas se distinguem por `valor`: com `valor = 0` é a VENDA A PRAZO (D-9) — '
  'o programa fechou e a paciente paga depois; com `valor > 0` é dinheiro que '
  'ENTROU e cuja forma a v20 nunca registrou (épico 9). A primeira sai de '
  '`DINHEIRO_QUE_ENTROU`; a segunda entra em receita e em LTV, e fica fora da '
  'conferência do caixa por forma (`NA_GAVETA`), porque não há linha de gaveta '
  'contra a qual conferi-la.';

-- ---------------------------------------------------------------------------
-- 3. RLS, TRILHA E PRIVILÉGIO.
--
-- `origens_da_v20` tem `clinica_id`, então ela entra na convenção inteira —
-- e `teste/isolamento-de-clinica.test.ts` exige igualdade EXATA entre o
-- catálogo e `ENTIDADES_COM_CLINICA`: uma tabela nova sem policy reprova lá,
-- e sem trigger reprova em `auditoria-inescapavel`.
--
-- `ENABLE` mais `FORCE`: sem o `FORCE`, o dono da tabela escapa da política.
-- ---------------------------------------------------------------------------
ALTER TABLE origens_da_v20 ENABLE ROW LEVEL SECURITY;
ALTER TABLE origens_da_v20 FORCE  ROW LEVEL SECURITY;

CREATE POLICY origens_da_v20_por_clinica ON origens_da_v20
  USING (clinica_id = app_clinica_id())
  WITH CHECK (clinica_id = app_clinica_id());

CREATE TRIGGER origens_da_v20_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON origens_da_v20
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

-- `fir_app` ganha os quatro porque o migrador roda pelo pool do produto, com
-- `naClinica(clinicaId, SISTEMA, …)` — ele NÃO usa `fir_migrate`, e isso é
-- deliberado: `fir_migrate` tem BYPASSRLS, e uma migração que atravessa a RLS
-- é uma migração que pode escrever na clínica errada sem o banco recusar.
GRANT SELECT, INSERT, UPDATE, DELETE ON origens_da_v20 TO fir_app;

-- ---------------------------------------------------------------------------
-- G4 — fatos agregados: `uso_diario_cliente` e `campanhas_carteira`.
-- ADRs 0011, 0012, 0013.
--
-- NENHUMA DAS DUAS TEM `clinica_id`. De propósito: a ligação é por
-- `cliente_carteira_id` (que já carrega `clinica_id` — `clientes_carteira`),
-- e sem a coluna elas não entram na varredura universal de
-- `isolamento-de-clinica.test.ts`/`auditoria-inescapavel.test.ts` (que
-- exigiriam RLS por `clinica_id` e o trigger `registrar_auditoria`, que
-- quebraria sem a coluna para extrair). Mesma classificação de `operadores`/
-- `usuarios_gestao`: dado da carteira, não dado DA clínica — a trilha de
-- ESCRITA destas tabelas não é a pergunta que falta; a de LEITURA
-- (`auditoria_da_carteira`, ADR 0013 §7) é, e chega quando existir o
-- primeiro dashboard que lê.
--
-- ⚠️ ESTA MIGRATION CRIA SÓ AS TABELAS. O job que POPULA `uso_diario_cliente`
-- (lendo `tarefas`/`jornada`/financeiro dentro de cada clínica) e o que
-- sincroniza `campanhas_carteira` (lendo `campanhas` + o cálculo de
-- resultado que `CampanhasService` já faz) são trabalho à parte — não
-- recalcular a regra aqui seria repeti-la (ADR 0013 §5).
-- ---------------------------------------------------------------------------

CREATE TABLE uso_diario_cliente (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_carteira_id uuid NOT NULL REFERENCES clientes_carteira(id),
  grupo_id            uuid NOT NULL REFERENCES grupos(id),
  dia                 date NOT NULL,

  -- Só CONTAGEM (regra de minimização, ADR 0013 §2). NUNCA nome de
  -- funcionária: o contrato original do protótipo tinha `usuarios[{nome,
  -- ultimo_acesso}]`, e foi cortado no gate de LGPD — ver CONTEXT.md.
  -- `rotinas_previstas`, `rotinas_cumpridas` e `recaptacoes` do contrato
  -- original do protótipo NÃO entram aqui — mapeamento de fontes (sessão de
  -- 2026-11-05) confirmou que nenhuma das três tem fonte real no domínio FIR
  -- hoje: não existe entidade "Rotina" cruzando marcadores (só o RÓTULO
  -- `tarefas.marcador`, sem noção de "prevista vs. cumprida"), e não existe
  -- evento de "recaptação" registrado em lugar nenhum — só um FILTRO de
  -- candidatas (`pacientes.service.ts`, atalho `sem-retorno`), que é consulta,
  -- não acontecimento. Mesmo padrão de corte da ADR 0013 §5 para
  -- `investimento`/`receita_continuada` de campanha: não se sincroniza o que
  -- não existe na fonte. Ver ADR 0014.
  usuarios_cadastrados     int NOT NULL DEFAULT 0 CHECK (usuarios_cadastrados >= 0),
  usuarios_ativos          int NOT NULL DEFAULT 0 CHECK (usuarios_ativos >= 0),
  tarefas_criadas          int NOT NULL DEFAULT 0 CHECK (tarefas_criadas >= 0),
  tarefas_concluidas       int NOT NULL DEFAULT 0 CHECK (tarefas_concluidas >= 0),
  tarefas_no_prazo         int NOT NULL DEFAULT 0 CHECK (tarefas_no_prazo >= 0),
  -- Snapshot do backlog ao FIM do dia, não evento aditivo do dia — diferente
  -- das contagens acima. Não some ao longo de um período sem contar duas
  -- vezes a mesma tarefa aberta em dois dias seguidos.
  tarefas_vencidas_abertas int NOT NULL DEFAULT 0 CHECK (tarefas_vencidas_abertas >= 0),
  contatos_pacientes       int NOT NULL DEFAULT 0 CHECK (contatos_pacientes >= 0),
  orcamentos_enviados      int NOT NULL DEFAULT 0 CHECK (orcamentos_enviados >= 0),
  orcamentos_pagos         int NOT NULL DEFAULT 0 CHECK (orcamentos_pagos >= 0),
  faltas                   int NOT NULL DEFAULT 0 CHECK (faltas >= 0),
  -- A definição exata de "recontatada" (só falta, ou falta+desmarque; data
  -- do reagendamento ou da falta original) é decisão de produto em aberto
  -- (plano §9) — a coluna nasce, mas o job não escreve nela até a decisão
  -- vir; `0` aqui seria "zero recontatos", não "ainda não decidido". Fica
  -- como exceção documentada até a decisão: diferente de rotinas/recaptações,
  -- AQUI existe caminho de cálculo (é só uma escolha entre duas definições).
  faltas_recontatadas      int NOT NULL DEFAULT 0 CHECK (faltas_recontatadas >= 0),
  -- Dinheiro de verdade (regra 1): inteiro em centavos, nunca float. É o
  -- "dinheiro que entrou" do dia (regra do CONTEXT.md), já calculado pelo
  -- financeiro da clínica — nunca recalculado aqui.
  receita_registrada       bigint NOT NULL DEFAULT 0 CHECK (receita_registrada >= 0),

  criado_em timestamptz NOT NULL DEFAULT now(),
  -- Idempotência (regra 26): o job roda de novo e atualiza a mesma linha,
  -- nunca duplica. `UPSERT` é o job; a constraint é o que torna um bug no
  -- job incapaz de duplicar o dia.
  UNIQUE (cliente_carteira_id, dia)
);

COMMENT ON TABLE uso_diario_cliente IS
  'Fato diário agregado, por Cliente Firmare. Populado por job dentro da '
  'clínica (fir_app, app.clinica_id fixado) — nunca consulta ao vivo cruzando '
  'RLS. grupo_id é resolvido de clientes_carteira.clinica_id no momento da '
  'escrita, nunca aceito como parâmetro.';

ALTER TABLE uso_diario_cliente ENABLE ROW LEVEL SECURITY;
ALTER TABLE uso_diario_cliente FORCE  ROW LEVEL SECURITY;
CREATE POLICY uso_diario_cliente_por_grupo ON uso_diario_cliente
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

REVOKE ALL ON uso_diario_cliente FROM fir_app;
GRANT SELECT, INSERT, UPDATE ON uso_diario_cliente TO fir_carteira;

-- ---------------------------------------------------------------------------
-- `campanhas_carteira` — "uma tela, duas fontes" (ADR 0011/0013).
-- ---------------------------------------------------------------------------
CREATE TABLE campanhas_carteira (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_carteira_id uuid NOT NULL REFERENCES clientes_carteira(id),
  grupo_id            uuid NOT NULL REFERENCES grupos(id),
  -- A campanha REAL da clínica, quando sincronizada. NULL quando a origem é
  -- manual (cliente só de consultoria, sem FIR Clinic) — ADR 0013 §5.
  campanha_origem_id  uuid REFERENCES campanhas(id),
  origem              text NOT NULL CHECK (origem IN ('sincronizada', 'manual')),

  nome            text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 80),
  periodo_inicio  date NOT NULL,
  periodo_fim     date NOT NULL,
  -- As mesmas quatro de `campanhas.metrica` (0020) — mesmo vocabulário,
  -- nunca um segundo enum para o mesmo conceito.
  metrica         text NOT NULL CHECK (metrica IN ('convertidos', 'contatos', 'tipo', 'receita')),
  meta            bigint NOT NULL CHECK (meta > 0),
  -- NULL até o job sincronizar ou alguém lançar à mão. Nunca um 0 que
  -- confundiria "resultado zero medido" com "ainda não medido".
  resultado       bigint CHECK (resultado IS NULL OR resultado >= 0),

  -- `investimento` e `receita_continuada` do protótipo NÃO entram aqui —
  -- ADR 0013 §5: não existem em `CampanhasModule` hoje, e aritmética de
  -- ponto flutuante do legado não atravessa. Ausência deliberada, não
  -- esquecimento.

  atualizado_em timestamptz NOT NULL DEFAULT now(),
  criado_em     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT campanhas_carteira_origem_consistente CHECK (
    (origem = 'sincronizada') = (campanha_origem_id IS NOT NULL)
  )
);
-- Uma campanha real sincroniza para NO MÁXIMO uma linha da carteira — o job
-- faz UPSERT por esta chave, nunca duplica.
CREATE UNIQUE INDEX campanhas_carteira_por_origem ON campanhas_carteira (campanha_origem_id)
  WHERE campanha_origem_id IS NOT NULL;

COMMENT ON TABLE campanhas_carteira IS
  'Uma tela, duas fontes (ADR 0011/0013): sincronizada do CampanhasModule '
  'quando o Cliente Firmare tem clinica_id ligado; lançada à mão quando não '
  'tem. O job de sincronização NUNCA recalcula resultado com fórmula '
  'própria — copia o que CampanhasService já calculou.';

ALTER TABLE campanhas_carteira ENABLE ROW LEVEL SECURITY;
ALTER TABLE campanhas_carteira FORCE  ROW LEVEL SECURITY;
CREATE POLICY campanhas_carteira_por_grupo ON campanhas_carteira
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

REVOKE ALL ON campanhas_carteira FROM fir_app;
GRANT SELECT, INSERT, UPDATE ON campanhas_carteira TO fir_carteira;

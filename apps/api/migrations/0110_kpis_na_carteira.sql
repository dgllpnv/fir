-- ---------------------------------------------------------------------------
-- T10 — `kpis_na_carteira`: os indicadores da clínica, vistos pela carteira.
-- Spec I-47 · appsec C5, C26, C28 · LGPD L-IN-18 · ADR 0013 e a emenda
-- `docs/adr/2026-11-17-kpis-na-carteira-emenda-a-0013.md`.
--
-- No molde da 0028/0046 (`uso_diario_cliente`): SEM `clinica_id`. A ligação é
-- por `cliente_carteira_id`, que já carrega a clínica; a RLS é por GRUPO,
-- forçada. Dado da carteira, não dado DA clínica.
--
-- Uma linha por (Cliente Firmare, KPI, dia). O job `uso-diario-cliente` a
-- escreve com o que a `CalculadoraDeKpi` (`IndicadoresService.listar`) devolve
-- dentro da clínica, como `fir_app` em `naClinica` — nunca uma conta paralela.
-- Só para cliente cuja clínica PARTICIPA do grupo (vínculo ativo); no
-- desvínculo, nada novo.
--
-- O QUE NÃO ATRAVESSA, garantido também aqui, e não só no job:
--  * os três KPIs de RH do catálogo (appsec C5): CHECK;
--  * valor e alvo no pilar Pessoas (LGPD L-IN-18) e no resultado de campanha
--    (ADR 0013 §4, receita de campanha pequena): CHECK;
--  * `como_medir`, comentário, responsável, composição, paciente: não há coluna.
-- ---------------------------------------------------------------------------

CREATE TABLE kpis_na_carteira (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_carteira_id uuid NOT NULL REFERENCES clientes_carteira(id),
  grupo_id            uuid NOT NULL REFERENCES grupos(id),
  -- O id do KPI na clínica. Sem FK de propósito: `kpis` é da clínica (RLS por
  -- `clinica_id`), e a checagem de FK não passa por RLS (appsec C24).
  kpi_ref             uuid NOT NULL,
  -- O dia civil da clínica, no fuso dela, em que a fotografia foi tirada.
  dia                 date NOT NULL,

  chave_catalogo      text CHECK (chave_catalogo IS NULL OR chave_catalogo IN (
                        'faturamento_conferido', 'resultado_do_mes', 'ticket_medio',
                        'despesas_fixas_sobre_recebido', 'saldo_a_receber', 'caixas_sem_diferenca',
                        'novos_pacientes', 'conversao_de_orcamentos', 'valor_fechado_em_orcamentos',
                        'comparecimento', 'faltas_recontatadas', 'pacientes_recaptados',
                        'resultado_de_campanha', 'tarefas_no_prazo', 'rotinas_cumpridas',
                        'perda_de_estoque', 'itens_abaixo_do_minimo')),
  -- O nome do KPI. No manual é texto livre: o formulário avisa "não use nome
  -- de pessoa nem de paciente" (L-IN-18). Nunca vai para log (appsec C29).
  nome                text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 80),
  pilar               text NOT NULL CHECK (pilar IN ('Financeiro', 'Comercial', 'Processos', 'Pessoas')),
  unidade             text NOT NULL CHECK (unidade IN ('reais', 'percentual', 'quantidade', 'dias', 'nota', 'horas')),

  -- Inteiro na menor unidade (regras 1 e 8), XOR pela unidade. NULL = sem dado.
  valor_centavos      bigint,
  valor_numero        bigint,
  alvo_centavos       bigint,
  alvo_numero         bigint,
  prazo               date,
  situacao            text CHECK (situacao IS NULL OR situacao IN ('atingida', 'no_ritmo', 'atencao', 'abaixo', 'sem_dado')),
  percentual_da_meta  integer,

  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),

  -- Idempotência (regra 26): o job reescreve a mesma linha, nunca duplica.
  CONSTRAINT kpis_na_carteira_um_por_dia UNIQUE (cliente_carteira_id, kpi_ref, dia),
  CONSTRAINT kpis_na_carteira_valor_na_coluna_da_unidade CHECK (
    CASE WHEN unidade = 'reais'
         THEN valor_numero IS NULL AND alvo_numero IS NULL
         ELSE valor_centavos IS NULL AND alvo_centavos IS NULL
    END),
  -- L-IN-18 e ADR 0013 §4: só situação e percentual.
  CONSTRAINT kpis_na_carteira_sem_valor_onde_nao_atravessa CHECK (
    (pilar <> 'Pessoas' AND chave_catalogo IS DISTINCT FROM 'resultado_de_campanha')
    OR (valor_centavos IS NULL AND valor_numero IS NULL AND alvo_centavos IS NULL AND alvo_numero IS NULL)),
  CONSTRAINT kpis_na_carteira_meta_coerente CHECK (
    (prazo IS NULL) = (situacao IS NULL))
);
CREATE INDEX kpis_na_carteira_por_cliente ON kpis_na_carteira (cliente_carteira_id, dia);

COMMENT ON TABLE kpis_na_carteira IS
  'Fotografia diária dos KPIs da clínica para a carteira (T10, I-47). Populada '
  'pelo job uso-diario-cliente a partir da CalculadoraDeKpi, dentro da clínica '
  '(fir_app, naClinica). Sem os KPIs de RH; sem valor no pilar Pessoas. '
  'grupo_id vem de clientes_carteira, nunca de parâmetro. Retenção: 2 anos.';

ALTER TABLE kpis_na_carteira ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpis_na_carteira FORCE  ROW LEVEL SECURITY;
CREATE POLICY kpis_na_carteira_por_grupo ON kpis_na_carteira
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

REVOKE ALL ON kpis_na_carteira FROM PUBLIC, fir_app;
GRANT SELECT, INSERT, UPDATE ON kpis_na_carteira TO fir_carteira;

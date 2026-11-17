-- ===========================================================================
-- INDICADORES & INSIGHTS — o esquema (spec `docs/specs/indicadores-e-insights.md`,
-- ticket T1; ADR 2026-11-17-kpi-escala-e-valor-na-tela).
--
-- Sete tabelas novas e uma coluna em `tarefas`. Fora daqui: favoritos e
-- `pacientes_da_exportacao` (0101), a chave de idempotência da campanha
-- (0102) e `kpis_na_carteira` (0103). A migração de `metas_do_mes` é a 0100.
--
-- As quatro decisões que valem para TODAS as tabelas:
--
--  1. `clinica_id NOT NULL`, RLS ENABLE + FORCE, policy com USING **e** WITH
--     CHECK (regra 19, appsec C24).
--  2. **Toda referência é FK COMPOSTA `(clinica_id, x)`** (appsec C24, I-48). A
--     checagem de FK não passa pela RLS: com FK simples, um `kpi_id` da clínica
--     B gravado sob a clínica A passaria, e a RLS só esconderia a leitura. As
--     tabelas-mãe novas nascem com `UNIQUE (clinica_id, id)`; `pessoas` já o tem
--     desde a 0018.
--  3. **Valor em XOR de coluna**: `*_centavos` (reais, `Dinheiro`) ou
--     `*_numero` (centésimos ou minutos, `ESCALA_DA_UNIDADE`), nunca os dois.
--     `bigint` sempre, nunca `numeric` (regras 1 e 8).
--  4. **Nenhum DELETE para `fir_app`** (appsec C25, I-49). Arquivar é estado.
--     `fotografias_de_kpi` aceita só INSERT.
-- ===========================================================================
SELECT set_config('app.pessoa_id', 'sistema', true);

-- ---------------------------------------------------------------------------
-- KPIS
--
-- `origem = 'catalogo'`: uma das 20 chaves de
-- `packages/domain/src/indicadores/catalogo.ts`; pilar, unidade e direção vêm
-- do catálogo e ficam NULL aqui (uma fonte só). `origem = 'manual'`: a clínica
-- declara os três, e o KPI é sempre `posicao` (I-5).
--
-- `parametros NOT NULL DEFAULT '{}'` (números c.13): com NULL, o UNIQUE abaixo
-- aceitaria dois "faturamento conferido" vivos, e a Visão do mês leria um
-- qualquer.
-- ---------------------------------------------------------------------------
CREATE TABLE kpis (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id          uuid NOT NULL REFERENCES clinicas(id),
  origem              text NOT NULL CHECK (origem IN ('catalogo', 'manual')),
  chave_catalogo      text CHECK (chave_catalogo IN (
                        'faturamento_conferido', 'resultado_do_mes', 'ticket_medio',
                        'despesas_fixas_sobre_recebido', 'saldo_a_receber', 'caixas_sem_diferenca',
                        'novos_pacientes', 'conversao_de_orcamentos', 'valor_fechado_em_orcamentos',
                        'comparecimento', 'faltas_recontatadas', 'pacientes_recaptados',
                        'resultado_de_campanha', 'tarefas_no_prazo', 'rotinas_cumpridas',
                        'perda_de_estoque', 'itens_abaixo_do_minimo', 'atingimento_metas_individuais',
                        'saldo_banco_de_horas', 'conversas_1a1_em_dia')),
  parametros          jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(parametros) = 'object'),
  -- Nome livre do KPI manual: o formulário avisa "não use nome de pessoa nem de
  -- paciente" (LGPD L-IN-18). Nunca vai para log (appsec C29).
  nome                text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 80),
  pilar               text CHECK (pilar IN ('Financeiro', 'Comercial', 'Processos', 'Pessoas')),
  unidade             text CHECK (unidade IN ('reais', 'percentual', 'quantidade', 'dias', 'nota', 'horas')),
  direcao             text CHECK (direcao IN ('maior', 'menor')),
  frequencia          text NOT NULL CHECK (frequencia IN ('semanal', 'mensal')),
  -- Semanal: 1–7 (1 = segunda). Mensal: 1–31, e o dia que não existe no mês cai
  -- no último (regra 25, `prazoDoLancamento`).
  dia_de_lancamento   smallint CHECK (dia_de_lancamento BETWEEN 1 AND 31),
  -- Texto livre: aviso fixo "não escreva nome de paciente" (LGPD R-e).
  como_medir          text NOT NULL DEFAULT '' CHECK (length(como_medir) <= 140),
  responsavel_id      uuid,
  -- O cursor do job de tarefas de lançamento (I-30): gera para a frente, nunca para trás.
  tarefas_geradas_ate date,
  criado_por          uuid,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  arquivado_em        timestamptz,

  CONSTRAINT kpis_clinica_id_id_key UNIQUE (clinica_id, id),
  CONSTRAINT kpi_origem_coerente CHECK (
    (origem = 'catalogo'
       AND chave_catalogo IS NOT NULL
       AND pilar IS NULL AND unidade IS NULL AND direcao IS NULL
       AND dia_de_lancamento IS NULL)
    OR
    (origem = 'manual'
       AND chave_catalogo IS NULL AND parametros = '{}'::jsonb
       AND pilar IS NOT NULL AND unidade IS NOT NULL AND direcao IS NOT NULL
       AND dia_de_lancamento IS NOT NULL)),
  CONSTRAINT kpi_dia_de_lancamento_da_semana CHECK (
    dia_de_lancamento IS NULL OR frequencia = 'mensal' OR dia_de_lancamento <= 7),
  CONSTRAINT kpi_responsavel_da_clinica
    FOREIGN KEY (clinica_id, responsavel_id) REFERENCES pessoas (clinica_id, id),
  CONSTRAINT kpi_criado_por_da_clinica
    FOREIGN KEY (clinica_id, criado_por) REFERENCES pessoas (clinica_id, id)
);

-- Único por (clínica, chave, parâmetros) entre os VIVOS. Arquivado não conta:
-- arquivar e recriar é permitido, e a trilha guarda os dois.
CREATE UNIQUE INDEX kpi_de_catalogo_unico_vivo
  ON kpis (clinica_id, chave_catalogo, parametros)
  WHERE origem = 'catalogo' AND arquivado_em IS NULL;
CREATE INDEX kpis_vivos_da_clinica ON kpis (clinica_id) WHERE arquivado_em IS NULL;

COMMENT ON TABLE kpis IS
  'KPI da clínica: do catálogo (chave_catalogo) ou manual. Arquivar é estado; '
  'sem DELETE para fir_app.';

-- ---------------------------------------------------------------------------
-- LANÇAMENTOS DE KPI (manual)
--
-- Idempotente por (kpi, referência): relançar CORRIGE a mesma linha (UPDATE),
-- e a trilha guarda de → para (C.2). A referência é a segunda-feira (semanal)
-- ou o dia 1º (mensal); a função pura é `referenciaDoPeriodo`.
-- ---------------------------------------------------------------------------
CREATE TABLE lancamentos_de_kpi (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id      uuid NOT NULL REFERENCES clinicas(id),
  kpi_id          uuid NOT NULL,
  referencia      date NOT NULL,
  valor_centavos  bigint,
  valor_numero    bigint,
  -- Texto livre: aviso fixo "não escreva nome de paciente" (LGPD R-e); nunca em log.
  comentario      text NOT NULL DEFAULT '' CHECK (length(comentario) <= 280),
  lancado_por     uuid NOT NULL,
  lancado_em      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT lancamento_valor_em_uma_coluna CHECK ((valor_centavos IS NULL) <> (valor_numero IS NULL)),
  CONSTRAINT lancamento_unico_por_referencia UNIQUE (kpi_id, referencia),
  CONSTRAINT lancamento_e_de_kpi_da_clinica
    FOREIGN KEY (clinica_id, kpi_id) REFERENCES kpis (clinica_id, id),
  CONSTRAINT lancamento_por_pessoa_da_clinica
    FOREIGN KEY (clinica_id, lancado_por) REFERENCES pessoas (clinica_id, id)
);
CREATE INDEX lancamentos_por_kpi ON lancamentos_de_kpi (clinica_id, kpi_id, referencia);

-- ---------------------------------------------------------------------------
-- OKRS e RESULTADOS-CHAVE
--
-- A trigger "de 1 a 5 KRs vivos" é do T4 (ela depende da rota que cria o OKR
-- junto com os KRs, na mesma transação).
-- ---------------------------------------------------------------------------
CREATE TABLE okrs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id      uuid NOT NULL REFERENCES clinicas(id),
  -- Textos livres: aviso fixo (LGPD R-e); nunca em log.
  objetivo        text NOT NULL CHECK (length(btrim(objetivo)) BETWEEN 1 AND 160),
  porque          text NOT NULL DEFAULT '' CHECK (length(porque) <= 500),
  tipo_periodo    text NOT NULL DEFAULT 'trimestre' CHECK (tipo_periodo IN ('trimestre', 'datas')),
  inicio          date NOT NULL,
  fim             date NOT NULL,
  responsavel_id  uuid,
  estado          text NOT NULL DEFAULT 'ativo' CHECK (estado IN ('ativo', 'encerrado')),
  encerrado_em    timestamptz,
  criado_por      uuid,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  arquivado_em    timestamptz,

  CONSTRAINT okrs_clinica_id_id_key UNIQUE (clinica_id, id),
  CONSTRAINT okr_fim_depois_do_inicio CHECK (fim >= inicio),
  CONSTRAINT okr_encerrado_coerente CHECK ((estado = 'encerrado') = (encerrado_em IS NOT NULL)),
  CONSTRAINT okr_responsavel_da_clinica
    FOREIGN KEY (clinica_id, responsavel_id) REFERENCES pessoas (clinica_id, id),
  CONSTRAINT okr_criado_por_da_clinica
    FOREIGN KEY (clinica_id, criado_por) REFERENCES pessoas (clinica_id, id)
);
CREATE INDEX okrs_vivos_da_clinica ON okrs (clinica_id, inicio) WHERE arquivado_em IS NULL;

CREATE TABLE resultados_chave (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id    uuid NOT NULL REFERENCES clinicas(id),
  okr_id        uuid NOT NULL,
  kpi_id        uuid NOT NULL,
  ordem         smallint NOT NULL CHECK (ordem BETWEEN 1 AND 5),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  arquivado_em  timestamptz,

  CONSTRAINT resultados_chave_clinica_id_id_key UNIQUE (clinica_id, id),
  CONSTRAINT kr_e_de_okr_da_clinica
    FOREIGN KEY (clinica_id, okr_id) REFERENCES okrs (clinica_id, id),
  CONSTRAINT kr_e_de_kpi_da_clinica
    FOREIGN KEY (clinica_id, kpi_id) REFERENCES kpis (clinica_id, id)
);
CREATE INDEX resultados_chave_do_okr ON resultados_chave (clinica_id, okr_id) WHERE arquivado_em IS NULL;

-- ---------------------------------------------------------------------------
-- SÉRIES DE META (meta recorrente, I-24)
--
-- Materializa a meta do mês corrente e do próximo em `metas_de_kpi`,
-- idempotente por `UNIQUE (serie_id, inicio)` lá embaixo.
-- ---------------------------------------------------------------------------
CREATE TABLE series_de_meta (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id          uuid NOT NULL REFERENCES clinicas(id),
  kpi_id              uuid NOT NULL,
  resultado_chave_id  uuid,
  alvo_centavos       bigint,
  alvo_numero         bigint,
  responsavel_id      uuid,
  medida_por          text NOT NULL DEFAULT 'fir' CHECK (medida_por IN ('fir', 'medx')),
  -- O primeiro mês da série: sempre o dia 1º.
  desde               date NOT NULL CHECK (extract(day FROM desde) = 1),
  criada_por          uuid,
  criada_em           timestamptz NOT NULL DEFAULT now(),
  arquivada_em        timestamptz,

  CONSTRAINT series_de_meta_clinica_id_id_key UNIQUE (clinica_id, id),
  CONSTRAINT serie_alvo_em_uma_coluna CHECK ((alvo_centavos IS NULL) <> (alvo_numero IS NULL)),
  CONSTRAINT serie_e_de_kpi_da_clinica
    FOREIGN KEY (clinica_id, kpi_id) REFERENCES kpis (clinica_id, id),
  CONSTRAINT serie_e_de_kr_da_clinica
    FOREIGN KEY (clinica_id, resultado_chave_id) REFERENCES resultados_chave (clinica_id, id),
  CONSTRAINT serie_responsavel_da_clinica
    FOREIGN KEY (clinica_id, responsavel_id) REFERENCES pessoas (clinica_id, id),
  CONSTRAINT serie_criada_por_da_clinica
    FOREIGN KEY (clinica_id, criada_por) REFERENCES pessoas (clinica_id, id)
);

-- ---------------------------------------------------------------------------
-- METAS DE KPI — o lugar único de meta (I-24 a I-26)
--
-- A meta de faturamento da Visão do mês passa a morar aqui pela 0100 (T2).
-- `definida_por`, `definida_em` e `medida_por` existem para a conferência
-- linha a linha da 0100 (números B7): o `EXCEPT` dos dois lados compara
-- `(clinica_id, competencia, valor, medida_por, definida_por, definida_em)`.
-- `origem_migracao` é o `metas_do_mes.id` copiado — sem FK, para não prender
-- o `DROP` futuro da tabela congelada.
-- ---------------------------------------------------------------------------
CREATE TABLE metas_de_kpi (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id          uuid NOT NULL REFERENCES clinicas(id),
  kpi_id              uuid NOT NULL,
  resultado_chave_id  uuid,
  serie_id            uuid,
  tipo                text NOT NULL CHECK (tipo IN ('mes', 'ate_data', 'recorrente')),
  inicio              date NOT NULL,
  -- Inclusivo: o dia que a pessoa vê. Toda conta passa por `janelaDaMeta`.
  prazo               date NOT NULL,
  alvo_centavos       bigint,
  alvo_numero         bigint,
  partida_centavos    bigint,
  partida_numero      bigint,
  responsavel_id      uuid,
  medida_por          text NOT NULL DEFAULT 'fir' CHECK (medida_por IN ('fir', 'medx')),
  origem_migracao     uuid UNIQUE,
  definida_por        uuid,
  definida_em         timestamptz NOT NULL DEFAULT now(),
  arquivada_em        timestamptz,

  CONSTRAINT metas_de_kpi_clinica_id_id_key UNIQUE (clinica_id, id),
  CONSTRAINT meta_prazo_depois_do_inicio CHECK (prazo >= inicio),
  CONSTRAINT meta_alvo_em_uma_coluna CHECK ((alvo_centavos IS NULL) <> (alvo_numero IS NULL)),
  -- A partida mora na MESMA coluna do alvo: a unidade é uma só.
  CONSTRAINT meta_partida_na_coluna_do_alvo CHECK (
    (partida_centavos IS NULL OR alvo_centavos IS NOT NULL)
    AND (partida_numero IS NULL OR alvo_numero IS NOT NULL)),
  CONSTRAINT meta_recorrente_tem_serie CHECK ((tipo = 'recorrente') = (serie_id IS NOT NULL)),
  CONSTRAINT meta_do_mes_e_mes_inteiro CHECK (
    tipo = 'ate_data'
    OR (extract(day FROM inicio) = 1
        AND prazo = (date_trunc('month', inicio) + interval '1 month - 1 day')::date)),
  CONSTRAINT meta_e_de_kpi_da_clinica
    FOREIGN KEY (clinica_id, kpi_id) REFERENCES kpis (clinica_id, id),
  CONSTRAINT meta_e_de_kr_da_clinica
    FOREIGN KEY (clinica_id, resultado_chave_id) REFERENCES resultados_chave (clinica_id, id),
  CONSTRAINT meta_e_de_serie_da_clinica
    FOREIGN KEY (clinica_id, serie_id) REFERENCES series_de_meta (clinica_id, id),
  CONSTRAINT meta_responsavel_da_clinica
    FOREIGN KEY (clinica_id, responsavel_id) REFERENCES pessoas (clinica_id, id),
  CONSTRAINT meta_definida_por_da_clinica
    FOREIGN KEY (clinica_id, definida_por) REFERENCES pessoas (clinica_id, id),
  CONSTRAINT meta_da_serie_unica_por_inicio UNIQUE (serie_id, inicio),

  -- I-25: UMA meta viva por KPI e contexto ("saúde" ou um KR), a qualquer
  -- instante. A leitura-antes-de-escrita do serviço não fecha a corrida de
  -- duas abas; este EXCLUDE fecha. `btree_gist` vem da 0018.
  CONSTRAINT uma_meta_viva_por_kpi_e_contexto EXCLUDE USING gist (
    kpi_id WITH =,
    (coalesce(resultado_chave_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    daterange(inicio, prazo, '[]') WITH &&
  ) WHERE (arquivada_em IS NULL)
);
CREATE INDEX metas_de_kpi_vivas ON metas_de_kpi (clinica_id, kpi_id, inicio) WHERE arquivada_em IS NULL;

-- ---------------------------------------------------------------------------
-- FOTOGRAFIAS DE KPI — a posição passada (I-6, números c.9)
--
-- A posição do dia D é o valor no INSTANTE `início(D+1)` no fuso da clínica,
-- não na hora em que o job rodou. Só INSERT (appsec C25): o job recompõe dia
-- perdido com `ON CONFLICT DO NOTHING`, que não precisa de UPDATE. Os dois
-- valores nulos = "sem dado", nunca zero.
-- ---------------------------------------------------------------------------
CREATE TABLE fotografias_de_kpi (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id      uuid NOT NULL REFERENCES clinicas(id),
  kpi_id          uuid NOT NULL,
  dia             date NOT NULL,
  valor_centavos  bigint,
  valor_numero    bigint,
  calculada_em    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fotografia_valor_em_no_maximo_uma_coluna CHECK (valor_centavos IS NULL OR valor_numero IS NULL),
  CONSTRAINT fotografia_unica_por_dia UNIQUE (kpi_id, dia),
  CONSTRAINT fotografia_e_de_kpi_da_clinica
    FOREIGN KEY (clinica_id, kpi_id) REFERENCES kpis (clinica_id, id)
);
CREATE INDEX fotografias_por_kpi ON fotografias_de_kpi (clinica_id, kpi_id, dia);

COMMENT ON TABLE fotografias_de_kpi IS
  'APPEND-ONLY. A posição de um KPI no instante início(D+1), no fuso da clínica. '
  'fir_app só lê e insere; o job usa ON CONFLICT DO NOTHING.';

-- ---------------------------------------------------------------------------
-- O PLANO DE AÇÃO: `tarefas.kpi_id` (I-46), FK COMPOSTA (appsec C24)
--
-- EXPAND: coluna nula, sem default. Nenhuma tarefa existente muda.
-- ---------------------------------------------------------------------------
ALTER TABLE tarefas ADD COLUMN kpi_id uuid;
ALTER TABLE tarefas ADD CONSTRAINT tarefa_kpi_da_clinica
  FOREIGN KEY (clinica_id, kpi_id) REFERENCES kpis (clinica_id, id);
CREATE INDEX tarefas_por_kpi ON tarefas (clinica_id, kpi_id) WHERE kpi_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RLS, TRILHA E PRIVILÉGIOS — uma tabela por bloco, para a varredura e para o olho.
-- ---------------------------------------------------------------------------
ALTER TABLE kpis ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpis FORCE  ROW LEVEL SECURITY;
CREATE POLICY kpis_por_clinica ON kpis
  USING (clinica_id = app_clinica_id()) WITH CHECK (clinica_id = app_clinica_id());
CREATE TRIGGER kpis_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON kpis
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

ALTER TABLE lancamentos_de_kpi ENABLE ROW LEVEL SECURITY;
ALTER TABLE lancamentos_de_kpi FORCE  ROW LEVEL SECURITY;
CREATE POLICY lancamentos_de_kpi_por_clinica ON lancamentos_de_kpi
  USING (clinica_id = app_clinica_id()) WITH CHECK (clinica_id = app_clinica_id());
CREATE TRIGGER lancamentos_de_kpi_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON lancamentos_de_kpi
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

ALTER TABLE okrs ENABLE ROW LEVEL SECURITY;
ALTER TABLE okrs FORCE  ROW LEVEL SECURITY;
CREATE POLICY okrs_por_clinica ON okrs
  USING (clinica_id = app_clinica_id()) WITH CHECK (clinica_id = app_clinica_id());
CREATE TRIGGER okrs_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON okrs
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

ALTER TABLE resultados_chave ENABLE ROW LEVEL SECURITY;
ALTER TABLE resultados_chave FORCE  ROW LEVEL SECURITY;
CREATE POLICY resultados_chave_por_clinica ON resultados_chave
  USING (clinica_id = app_clinica_id()) WITH CHECK (clinica_id = app_clinica_id());
CREATE TRIGGER resultados_chave_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON resultados_chave
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

ALTER TABLE series_de_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE series_de_meta FORCE  ROW LEVEL SECURITY;
CREATE POLICY series_de_meta_por_clinica ON series_de_meta
  USING (clinica_id = app_clinica_id()) WITH CHECK (clinica_id = app_clinica_id());
CREATE TRIGGER series_de_meta_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON series_de_meta
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

ALTER TABLE metas_de_kpi ENABLE ROW LEVEL SECURITY;
ALTER TABLE metas_de_kpi FORCE  ROW LEVEL SECURITY;
CREATE POLICY metas_de_kpi_por_clinica ON metas_de_kpi
  USING (clinica_id = app_clinica_id()) WITH CHECK (clinica_id = app_clinica_id());
CREATE TRIGGER metas_de_kpi_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON metas_de_kpi
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

ALTER TABLE fotografias_de_kpi ENABLE ROW LEVEL SECURITY;
ALTER TABLE fotografias_de_kpi FORCE  ROW LEVEL SECURITY;
CREATE POLICY fotografias_de_kpi_por_clinica ON fotografias_de_kpi
  USING (clinica_id = app_clinica_id()) WITH CHECK (clinica_id = app_clinica_id());
CREATE TRIGGER fotografias_de_kpi_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON fotografias_de_kpi
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

-- O `ALTER DEFAULT PRIVILEGES` do bootstrap concede SELECT/INSERT/UPDATE/DELETE.
-- O REVOKE é que faz a decisão 4. TRUNCATE também: ele não passa pela RLS.
REVOKE DELETE, TRUNCATE ON kpis, lancamentos_de_kpi, okrs, resultados_chave,
                           series_de_meta, metas_de_kpi FROM fir_app;
GRANT SELECT, INSERT, UPDATE ON kpis, lancamentos_de_kpi, okrs, resultados_chave,
                                series_de_meta, metas_de_kpi TO fir_app;

GRANT SELECT, INSERT ON fotografias_de_kpi TO fir_app;
REVOKE UPDATE, DELETE, TRUNCATE ON fotografias_de_kpi FROM fir_app;

-- Camada 2 do append-only: a trigger alcança o DONO, que o REVOKE não alcança.
CREATE FUNCTION fotografia_de_kpi_e_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'fotografia de KPI é append-only: % recusado', TG_OP;
END $$;

CREATE TRIGGER fotografias_de_kpi_sem_update
  BEFORE UPDATE OR DELETE OR TRUNCATE ON fotografias_de_kpi
  FOR EACH STATEMENT EXECUTE FUNCTION fotografia_de_kpi_e_append_only();

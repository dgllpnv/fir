-- ===========================================================================
-- G8, TICKET 2A — A ROTINA DA EQUIPE FIRMARE COMPLETA, IGUAL AO PROTÓTIPO.
--
-- Inventário `docs/specs/g8-paridade-gestao-inventario.md` (R1–R12, R14).
-- Protótipo `versoes/firmare-gestao-prototipo/index.html`: `rotinasPadrao`
-- L848, `datasRotina` L859, `freqTxt` L870, `aplica` L877, `datasVenc` L884,
-- `gerarRotinas` L894, `fRotina` L2776, `fTarefa` L2769, `proxima` L2789,
-- `vCarga`/`redistribuir` L1832–1860, `aniversariosProximos` L1903.
-- Gates: appsec A-20 (idempotência da recorrência e das rotinas), A-8; números
-- ajuste 38 (lembrete por competência), regras 23 e 25; LGPD A45–A47.
--
-- Forward-only, EXPAND: só colunas novas (anuláveis ou com default constante),
-- uma tabela nova, índices únicos parciais, um CHECK afrouxado (o formato
-- `lista`) e uma função estreita. Nada aplicado é editado; nada é destruído.
--
-- NÃO cria as colunas do cadastro do cliente que a geração lê
-- (`dia_vencimento`, `reuniao_dia_semana`, `reunioes_inicio`, `servicos`,
-- `data_inicio`, `responsavel_usuario_gestao_id`): são da 0047 (ticket 0.4).
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- PARTE 1 — `rotinas_internas`: os parâmetros que faltavam (R10, `fRotina`).
-- ---------------------------------------------------------------------------
ALTER TABLE rotinas_internas
  ADD COLUMN prioridade   text NOT NULL DEFAULT 'normal' CHECK (prioridade IN ('baixa', 'normal', 'alta')),
  -- ISO: 1 = segunda … 7 = domingo. Só para `semanal`.
  ADD COLUMN dia_semana   smallint CHECK (dia_semana BETWEEN 1 AND 7),
  -- "N-ésimo dia útil do mês" (1 = primeiro). Só para `mensal`. Nenhum mês
  -- tem mais de 23 dias de segunda a sexta.
  ADD COLUMN dia_util     smallint CHECK (dia_util BETWEEN 1 AND 23),
  -- "Dias antes do vencimento". Só para `vencimento`.
  ADD COLUMN antecedencia smallint CHECK (antecedencia BETWEEN 0 AND 31),
  -- "Para quais clientes". NULL = todos os clientes ativos (L2781).
  ADD COLUMN servico      text CHECK (servico IN ('semanal', 'fluxo', 'dre', 'pagamento', 'metas')),
  ADD COLUMN quem_executa text NOT NULL DEFAULT 'responsavel_da_rotina'
    CHECK (quem_executa IN ('responsavel_da_rotina', 'responsavel_do_cliente')),
  -- A CHAVE do modelo de mensagem (`mensagens_comerciais`, ticket 3A), nunca o texto.
  ADD COLUMN mensagem     text CHECK (mensagem IN ('pagamento', 'fluxo', 'dre', 'formulario', 'cobranca', 'acessos', 'semanal')),
  ADD COLUMN frentes      boolean NOT NULL DEFAULT false,
  ADD COLUMN envio        boolean NOT NULL DEFAULT false,
  -- "Excluir rotina" é estado (regra 20). Pausar é `ativa = false`; excluída
  -- some da lista e nunca mais gera.
  ADD COLUMN excluida_em  timestamptz,
  ADD COLUMN atualizada_em timestamptz NOT NULL DEFAULT now();

-- O formato "Uma tarefa com a lista de clientes para marcar" (R5, L2780) é o
-- terceiro valor. Trocar o CHECK só AFROUXA: toda linha que passava, passa.
ALTER TABLE rotinas_internas DROP CONSTRAINT rotinas_internas_escopo_aplicacao_check;
ALTER TABLE rotinas_internas ADD CONSTRAINT rotinas_internas_escopo_aplicacao_check
  CHECK (escopo_aplicacao IN ('global', 'lista', 'por_cliente'));

-- Backfill das linhas que já existem, ANTES dos CHECKs de coerência abaixo.
--  * semanal: o dia da semana do início (era a âncora da regra antiga, +7 dias).
--  * mensal: a posição do início entre os dias úteis do mês dele (mínimo 1).
--    A regra antiga era "mesmo dia do mês"; a nova é a do protótipo.
--  * vencimento: 3 dias, o padrão do formulário (L2984).
--  * vencimento/reunião em formato que nunca gerava nada passam a ser uma por
--    cliente — antes desta migration elas eram aceitas e ignoradas.
UPDATE rotinas_internas SET dia_semana = extract(isodow FROM inicio)::smallint
 WHERE frequencia = 'semanal' AND dia_semana IS NULL;
UPDATE rotinas_internas r SET dia_util = greatest(1, least(23, (
         SELECT count(*) FROM generate_series(date_trunc('month', r.inicio)::date, r.inicio, interval '1 day') d
          WHERE extract(isodow FROM d) < 6)))::smallint
 WHERE frequencia = 'mensal' AND dia_util IS NULL;
UPDATE rotinas_internas SET antecedencia = 3
 WHERE frequencia = 'vencimento' AND antecedencia IS NULL;
UPDATE rotinas_internas SET escopo_aplicacao = 'por_cliente'
 WHERE frequencia IN ('vencimento', 'reuniao') AND escopo_aplicacao <> 'por_cliente';

-- Coerência dos parâmetros — segunda camada de `validarParametrosDaRotina`
-- (packages/domain, `calendario-carteira.ts`).
ALTER TABLE rotinas_internas
  ADD CONSTRAINT rotinas_internas_semanal_tem_dia CHECK (frequencia <> 'semanal' OR dia_semana IS NOT NULL),
  ADD CONSTRAINT rotinas_internas_mensal_tem_dia_util CHECK (frequencia <> 'mensal' OR dia_util IS NOT NULL),
  ADD CONSTRAINT rotinas_internas_vencimento_tem_antecedencia CHECK (frequencia <> 'vencimento' OR antecedencia IS NOT NULL),
  ADD CONSTRAINT rotinas_internas_por_cliente_quando_precisa CHECK (
    (frequencia NOT IN ('vencimento', 'reuniao') AND NOT frentes AND NOT envio)
    OR escopo_aplicacao = 'por_cliente'
  );

COMMENT ON COLUMN rotinas_internas.dia_util IS
  'N-ésimo dia útil do mês (segunda a sexta; feriado ignorado, como no protótipo). Só para mensal.';
COMMENT ON COLUMN rotinas_internas.excluida_em IS
  '"Excluir rotina" (L2853) é estado, nunca DELETE (regra 20). As tarefas abertas são canceladas.';


-- ---------------------------------------------------------------------------
-- PARTE 2 — `tarefas_internas`: solicitante, recorrência, vencimento, efeitos.
-- ---------------------------------------------------------------------------
ALTER TABLE tarefas_internas
  ADD COLUMN solicitante_usuario_gestao_id uuid REFERENCES usuarios_gestao(id),
  ADD COLUMN recorrencia text NOT NULL DEFAULT 'nenhuma'
    CHECK (recorrencia IN ('nenhuma', 'diaria', 'semanal', 'mensal')),
  -- A tarefa recorrente que, ao ser concluída, gerou esta (R3).
  ADD COLUMN tarefa_origem_id uuid REFERENCES tarefas_internas(id),
  -- Rotina de vencimento: o vencimento e a COMPETÊNCIA (primeiro dia do mês do
  -- vencimento). A competência é a chave de idempotência (ajuste 38): mudar o
  -- `dia_vencimento` do cliente não cria um segundo lembrete no mesmo mês.
  ADD COLUMN vencimento  date,
  ADD COLUMN competencia date CHECK (competencia IS NULL OR extract(day FROM competencia) = 1),
  -- A chave do modelo de mensagem herdada da rotina (o texto é do 3A).
  ADD COLUMN mensagem text CHECK (mensagem IN ('pagamento', 'fluxo', 'dre', 'formulario', 'cobranca', 'acessos', 'semanal')),
  -- R14: o lembrete de mensalidade se concluiu sozinho porque o mês já estava pago.
  ADD COLUMN pago_antes boolean NOT NULL DEFAULT false,
  ADD COLUMN transferida_de_usuario_gestao_id uuid REFERENCES usuarios_gestao(id),
  -- Quem cancelou: a equipe ("Excluir", regra 27 — nunca se recria) ou a edição
  -- da rotina (L2853: as futuras abertas saem e a geração refaz).
  ADD COLUMN cancelada_por text CHECK (cancelada_por IN ('usuario', 'edicao_da_rotina')),
  ADD COLUMN atualizada_em timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT tarefas_internas_competencia_com_vencimento CHECK ((competencia IS NULL) = (vencimento IS NULL)),
  ADD CONSTRAINT tarefas_internas_cancelada_por_so_cancelada CHECK (cancelada_por IS NULL OR status = 'cancelada');

-- A-20: a próxima ocorrência de uma recorrente nasce UMA vez, por mais que o
-- "Concluir" se repita (duplo clique, retry, concluir-reabrir-concluir). Inclui
-- toda linha, inclusive cancelada: a equipe que cancelou a próxima não a vê
-- renascer (regra 27).
CREATE UNIQUE INDEX tarefas_internas_proxima_da_recorrencia
  ON tarefas_internas (tarefa_origem_id) WHERE tarefa_origem_id IS NOT NULL;

-- Ajuste 38: um lembrete por (rotina, cliente, competência) entre as vivas.
CREATE UNIQUE INDEX tarefas_internas_lembrete_por_competencia
  ON tarefas_internas (rotina_interna_id, cliente_carteira_id, competencia)
  WHERE competencia IS NOT NULL AND status <> 'cancelada' AND rotina_interna_id IS NOT NULL;

-- A lista "Minhas tarefas" e a carga leem por responsável e prazo.
CREATE INDEX tarefas_internas_abertas_por_responsavel_e_prazo
  ON tarefas_internas (responsavel_usuario_gestao_id, prazo) WHERE status = 'pendente';
-- R14 procura os lembretes de pagamento abertos por cliente e competência.
CREATE INDEX tarefas_internas_lembretes_abertos
  ON tarefas_internas (cliente_carteira_id, competencia) WHERE mensagem = 'pagamento' AND status = 'pendente';


-- ---------------------------------------------------------------------------
-- PARTE 3 — `itens_de_tarefa_interna` (R5): o checkbox por cliente da rotina
-- "com a lista de clientes" e as quatro frentes da tarefa de cada cliente.
--
-- `grupo_id` é DERIVADO da tarefa por trigger, nunca aceito de quem insere: a
-- tarefa da Firmare (grupo NULL) tem itens de grupo NULL, só visíveis a
-- `escopo='geral'`. Por que não FK composta `(tarefa, grupo)`: a tarefa tem
-- `grupo_id` anulável, e a FK composta não confere linha com NULL (MATCH
-- SIMPLE). O trigger confere sempre.
-- ---------------------------------------------------------------------------
CREATE TABLE itens_de_tarefa_interna (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_interna_id   uuid NOT NULL REFERENCES tarefas_internas(id),
  grupo_id            uuid REFERENCES grupos(id),
  ordem               smallint NOT NULL CHECK (ordem BETWEEN 1 AND 500),
  rotulo              text NOT NULL CHECK (length(btrim(rotulo)) BETWEEN 1 AND 200),
  cliente_carteira_id uuid REFERENCES clientes_carteira(id),
  frente              text CHECK (frente IN ('financeiro', 'comercial', 'trafego', 'marketing')),
  feito               boolean NOT NULL DEFAULT false,
  feito_em            timestamptz,
  feito_por_usuario_gestao_id uuid REFERENCES usuarios_gestao(id),
  criado_em           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT itens_de_tarefa_interna_feito_tem_data CHECK (feito = (feito_em IS NOT NULL)),
  -- Idempotência: os itens nascem junto com a tarefa, com ordem fixa.
  CONSTRAINT itens_de_tarefa_interna_um_por_ordem UNIQUE (tarefa_interna_id, ordem)
);

COMMENT ON TABLE itens_de_tarefa_interna IS
  'Subitem de uma Tarefa interna (G8 R5): um cliente da rotina "com a lista de '
  'clientes" ou uma frente do relatório. grupo_id derivado da tarefa (trigger). '
  'Marcar o último conclui a tarefa no servidor.';

CREATE INDEX itens_de_tarefa_interna_por_tarefa ON itens_de_tarefa_interna (tarefa_interna_id);
CREATE INDEX itens_de_tarefa_interna_por_grupo ON itens_de_tarefa_interna (grupo_id);

CREATE FUNCTION itens_de_tarefa_interna_grupo_da_tarefa() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  v_grupo uuid;
BEGIN
  -- Roda com o privilégio de quem escreve: uma tarefa invisível pela RLS não
  -- é encontrada, e o item é recusado como se ela não existisse.
  SELECT t.grupo_id INTO v_grupo FROM tarefas_internas t WHERE t.id = NEW.tarefa_interna_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tarefa interna inexistente' USING ERRCODE = '23503';
  END IF;
  NEW.grupo_id := v_grupo;
  IF TG_OP = 'UPDATE' AND NEW.tarefa_interna_id IS DISTINCT FROM OLD.tarefa_interna_id THEN
    RAISE EXCEPTION 'o item não muda de tarefa' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER itens_de_tarefa_interna_grupo_da_tarefa
  BEFORE INSERT OR UPDATE ON itens_de_tarefa_interna
  FOR EACH ROW EXECUTE FUNCTION itens_de_tarefa_interna_grupo_da_tarefa();

ALTER TABLE itens_de_tarefa_interna ENABLE ROW LEVEL SECURITY;
ALTER TABLE itens_de_tarefa_interna FORCE  ROW LEVEL SECURITY;
CREATE POLICY itens_de_tarefa_interna_por_grupo ON itens_de_tarefa_interna
  TO fir_carteira
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

REVOKE ALL ON itens_de_tarefa_interna FROM fir_app;
GRANT SELECT, INSERT, UPDATE ON itens_de_tarefa_interna TO fir_carteira;

CREATE TRIGGER itens_de_tarefa_interna_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON itens_de_tarefa_interna
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria_do_painel();


-- ---------------------------------------------------------------------------
-- PARTE 4 — Aniversário da equipe Firmare (P6, LGPD A47).
--
-- DIA e MÊS, nunca o ano (minimização, A28/A46 — o lembrete não precisa da
-- idade). `mostrar_aniversario` é a oposição simples, padrão `true` como o
-- gate recomenda (D-22: "siga o recomendado"). Base: art. 7º, IX.
--
-- `fir_carteira` continua SEM escrita em `usuarios_gestao` (F-1/A-1, 0041):
-- a própria pessoa grava o próprio aniversário por uma função estreita, que
-- resolve o ator pela sessão (`app.pessoa_id`) e só toca estas três colunas
-- da PRÓPRIA linha. Nenhum parâmetro diz de quem é a linha.
-- ---------------------------------------------------------------------------
ALTER TABLE usuarios_gestao
  ADD COLUMN aniversario_dia     smallint CHECK (aniversario_dia BETWEEN 1 AND 31),
  ADD COLUMN aniversario_mes     smallint CHECK (aniversario_mes BETWEEN 1 AND 12),
  ADD COLUMN mostrar_aniversario boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT usuarios_gestao_aniversario_valido CHECK (
    (aniversario_dia IS NULL) = (aniversario_mes IS NULL)
    AND (aniversario_dia IS NULL OR aniversario_dia <=
         CASE aniversario_mes WHEN 2 THEN 29 WHEN 4 THEN 30 WHEN 6 THEN 30
                              WHEN 9 THEN 30 WHEN 11 THEN 30 ELSE 31 END)
  );

COMMENT ON COLUMN usuarios_gestao.mostrar_aniversario IS
  'Oposição simples (LGPD A47): false tira o aniversário da lista da equipe. '
  'Retenção: até o desligamento (retencao.md).';

CREATE FUNCTION definir_meu_aniversario(p_dia smallint, p_mes smallint, p_mostrar boolean) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_cru  text := coalesce(current_setting('app.pessoa_id', true), '');
  v_tipo text;
  v_ator uuid;
BEGIN
  IF v_cru = '' THEN
    RAISE EXCEPTION 'definir_meu_aniversario: ator não declarado' USING ERRCODE = '42501';
  END IF;
  SELECT tipo, ator INTO v_tipo, v_ator FROM auditoria_resolver_ator(v_cru);
  IF v_tipo IS DISTINCT FROM 'usuario_gestao' OR v_ator IS NULL THEN
    RAISE EXCEPTION 'definir_meu_aniversario: só o próprio Usuário de Gestão' USING ERRCODE = '42501';
  END IF;
  UPDATE usuarios_gestao
     SET aniversario_dia = p_dia, aniversario_mes = p_mes, mostrar_aniversario = p_mostrar
   WHERE id = v_ator AND ativo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'definir_meu_aniversario: usuário inativo' USING ERRCODE = '42501';
  END IF;
END $$;

COMMENT ON FUNCTION definir_meu_aniversario(smallint, smallint, boolean) IS
  'LGPD A47: a própria pessoa grava dia/mês do aniversário e a oposição. Só a '
  'linha do ator da sessão (app.pessoa_id), só estas três colunas.';

REVOKE ALL ON FUNCTION definir_meu_aniversario(smallint, smallint, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION definir_meu_aniversario(smallint, smallint, boolean) TO fir_carteira;

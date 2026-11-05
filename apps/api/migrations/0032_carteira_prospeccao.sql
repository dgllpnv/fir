-- ---------------------------------------------------------------------------
-- G5 — FUNIL DE PROSPECÇÃO (`leads_comerciais`) E ROTINA INTERNA DA EQUIPE
-- FIRMARE (`rotinas_internas`/`tarefas_internas`/`checkins_internos`).
--
-- `docs/superpowers/plans/g5-spec-rotina-interna-funil.md`, ADR 0016.
--
-- Primeira vez que uma sessão de `Usuário de Gestão` (não o `Operador`)
-- ESCREVE dado de negócio na carteira (emenda à ADR 0011, item 1 da ADR
-- 0016). A validação de que `grupo_id`/`responsavel_usuario_gestao_id`
-- nunca vêm crus do corpo da requisição é responsabilidade do SERVICE
-- (`packages/domain/src/prospeccao.ts`, `resolverGrupoDeEscrita`) — a RLS
-- abaixo é a SEGUNDA camada (regra 19 do CLAUDE.md), nunca a única.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- PARTE 1 — O BLOQUEADOR DE MERGE DO ADR 0016 (seção 3, "achado de
-- verificação"): `clientes_carteira.clinica_id` vira nullable para que um
-- lead fechado (`ganho`) possa nascer como `Cliente Firmare` ANTES de
-- existir uma `Clinica` real (spec §2.3, §6.1). Sem a correção que segue, o
-- `INSERT` do primeiro lead fechado em produção quebraria: o trigger
-- genérico `registrar_auditoria()` deriva `auditoria.clinica_id` direto da
-- coluna, e `auditoria.clinica_id` é `NOT NULL` desde a migration 0002.
-- ---------------------------------------------------------------------------

ALTER TABLE clientes_carteira ALTER COLUMN clinica_id DROP NOT NULL;

ALTER TABLE clientes_carteira ADD CONSTRAINT clientes_carteira_onboarding_sem_clinica
  CHECK (status = 'onboarding' OR clinica_id IS NOT NULL);

COMMENT ON COLUMN clientes_carteira.clinica_id IS
  'Nullable (G5): um Cliente Firmare pode nascer de uma conversão de lead '
  'ANTES de existir uma Clinica real (status=onboarding). O CHECK ao lado '
  'garante que todo status além de onboarding já tem uma clinica vinculada '
  '— nenhum quinto status novo; onboarding já significava exatamente isto.';

-- ---------------------------------------------------------------------------
-- O helper que resolve "quem escreveu" a partir de `app.pessoa_id` — extraído
-- de dentro de `registrar_auditoria()` (migration 0025) para ser reaproveitado
-- pelas DUAS funções de trigger abaixo, sem duplicar o `IF/ELSIF` em três
-- lugares (é exatamente o "espécie de regra escrita duas vezes" que o
-- CLAUDE.md pede para evitar). `registrar_auditoria()` é redefinida ao fim
-- desta migration para chamar este helper também — `CREATE OR REPLACE`,
-- nunca uma edição de migration já aplicada.
--
-- Não resolve o caso `v_cru = ''` (ator não declarado): cada trigger
-- continua checando isso e lançando com o nome da SUA tabela em
-- `TG_TABLE_NAME` — um helper não tem acesso a essa variável de trigger.
-- ---------------------------------------------------------------------------
CREATE FUNCTION auditoria_resolver_ator(v_cru text, OUT tipo text, OUT ator uuid)
  LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF v_cru = 'sistema' THEN
    tipo := 'sistema';
    ator := NULL;
  ELSIF left(v_cru, 9) = 'operador:' THEN
    tipo := 'operador';
    ator := substr(v_cru, 10)::uuid;
  ELSIF left(v_cru, 15) = 'usuario_gestao:' THEN
    tipo := 'usuario_gestao';
    ator := substr(v_cru, 16)::uuid;
  ELSE
    tipo := 'pessoa';
    ator := v_cru::uuid;
  END IF;
END $$;

COMMENT ON FUNCTION auditoria_resolver_ator(text) IS
  'Traduz app.pessoa_id cru (sistema | operador:<uuid> | usuario_gestao:<uuid> '
  '| <uuid> de pessoa) em (ator_tipo, ator_id) — a MESMA tradução que '
  'registrar_auditoria() fazia inline, agora reaproveitada por ela e pelas '
  'duas funções de trigger desta migration.';

-- `auditoria_do_painel.ator_tipo` ganha 'usuario_gestao': G5 é a primeira
-- escrita de Usuário de Gestão em tabela SEM clinica_id nenhum — até aqui só
-- 'operador', 'vps' e 'sistema' escreviam ali (migration 0013).
ALTER TABLE auditoria_do_painel DROP CONSTRAINT IF EXISTS auditoria_do_painel_ator_tipo_check;
ALTER TABLE auditoria_do_painel ADD CONSTRAINT auditoria_do_painel_ator_tipo_check
  CHECK (ator_tipo IN ('operador', 'vps', 'sistema', 'usuario_gestao'));

-- `registrar_auditoria()`: corpo inteiro copiado da 0025, trocando o `IF/ELSIF`
-- de tradução de ator pela chamada ao helper acima. Comportamento idêntico —
-- só a duplicação sai.
CREATE OR REPLACE FUNCTION registrar_auditoria() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_cru     text := coalesce(current_setting('app.pessoa_id', true), '');
  v_tipo    text;
  v_ator    uuid;
  v_old     jsonb;
  v_new     jsonb;
  v_de      jsonb;
  v_para    jsonb;
  v_id      text;
  v_clinica uuid;
BEGIN
  IF v_cru = '' THEN
    RAISE EXCEPTION 'ator não declarado: escrita em % recusada', TG_TABLE_NAME
      USING HINT = 'Use banco.naClinica(clinica, ator, …). Em job, semente ou '
                   'migration de dados, passe SISTEMA — explicitamente.';
  END IF;

  SELECT tipo, ator INTO v_tipo, v_ator FROM auditoria_resolver_ator(v_cru);

  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;

  IF TG_OP = 'DELETE' THEN
    v_de := v_old;
    v_para := NULL;
    v_id := v_old ->> 'id';
    v_clinica := (v_old ->> 'clinica_id')::uuid;
  ELSIF TG_OP = 'INSERT' THEN
    v_de := NULL;
    v_para := v_new;
    v_id := v_new ->> 'id';
    v_clinica := (v_new ->> 'clinica_id')::uuid;
  ELSE
    SELECT jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k)
      INTO v_de, v_para
      FROM jsonb_object_keys(v_new) k
     WHERE v_old -> k IS DISTINCT FROM v_new -> k;
    IF v_para IS NULL THEN RETURN NULL; END IF;
    v_id := v_new ->> 'id';
    v_clinica := (v_new ->> 'clinica_id')::uuid;
  END IF;

  INSERT INTO public.auditoria
    (clinica_id, ator_tipo, ator_id, acao, entidade, entidade_id, de, para)
  VALUES (
    v_clinica,
    v_tipo,
    v_ator,
    CASE TG_OP WHEN 'INSERT' THEN 'criou' WHEN 'UPDATE' THEN 'alterou' ELSE 'removeu' END,
    TG_TABLE_NAME,
    v_id,
    public.auditoria_sem_segredos(v_de),
    public.auditoria_sem_segredos(v_para));

  RETURN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- `clientes_carteira` precisa de um trigger PRÓPRIO, não mais o genérico: com
-- `clinica_id` nullable, um `INSERT` de cliente em onboarding sem clínica
-- (lead recém-convertido) geraria `auditoria.clinica_id = NULL`, e essa
-- coluna é `NOT NULL` desde a migration 0002. Decisão registrada no ADR 0016
-- §3 e no spec §6.2: função PRÓPRIA (não um `CASE` dentro da genérica, que é
-- usada por DEZENAS de outras tabelas cujo `clinica_id` nunca é nulo e não
-- precisam desse ramo) — redireciona para `auditoria_do_painel` quando
-- `clinica_id IS NULL`, mesmo padrão de `grupos`/`usuarios_gestao` (0030).
-- ---------------------------------------------------------------------------
CREATE FUNCTION registrar_auditoria_carteira_cliente() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_cru     text := coalesce(current_setting('app.pessoa_id', true), '');
  v_tipo    text;
  v_ator    uuid;
  v_old     jsonb;
  v_new     jsonb;
  v_de      jsonb;
  v_para    jsonb;
  v_id      text;
  v_clinica uuid;
  v_acao    text := CASE TG_OP WHEN 'INSERT' THEN 'criou' WHEN 'UPDATE' THEN 'alterou' ELSE 'removeu' END;
BEGIN
  IF v_cru = '' THEN
    RAISE EXCEPTION 'ator não declarado: escrita em % recusada', TG_TABLE_NAME
      USING HINT = 'Use banco.nasTabelasDaCarteira*(ator, …).';
  END IF;

  SELECT tipo, ator INTO v_tipo, v_ator FROM auditoria_resolver_ator(v_cru);

  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;

  IF TG_OP = 'DELETE' THEN
    v_de := v_old; v_para := NULL; v_id := v_old ->> 'id';
    v_clinica := (v_old ->> 'clinica_id')::uuid;
  ELSIF TG_OP = 'INSERT' THEN
    v_de := NULL; v_para := v_new; v_id := v_new ->> 'id';
    v_clinica := (v_new ->> 'clinica_id')::uuid;
  ELSE
    SELECT jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k)
      INTO v_de, v_para
      FROM jsonb_object_keys(v_new) k
     WHERE v_old -> k IS DISTINCT FROM v_new -> k;
    IF v_para IS NULL THEN RETURN NULL; END IF;
    v_id := v_new ->> 'id';
    v_clinica := (v_new ->> 'clinica_id')::uuid;
  END IF;

  IF v_clinica IS NOT NULL THEN
    INSERT INTO public.auditoria
      (clinica_id, ator_tipo, ator_id, acao, entidade, entidade_id, de, para)
    VALUES (v_clinica, v_tipo, v_ator, v_acao, TG_TABLE_NAME, v_id,
            public.auditoria_sem_segredos(v_de), public.auditoria_sem_segredos(v_para));
  ELSE
    -- Sem clínica ainda (onboarding pós-conversão de lead): não há tenant
    -- para gravar a trilha DENTRO. Vai para auditoria_do_painel — "quem viu
    -- isto antes de virar clínica" responde por ali; quando clinica_id for
    -- preenchido depois, o UPDATE seguinte já cai no ramo acima, e a trilha
    -- muda de tabela de forma coerente (critério de aceite 6 do spec G5).
    INSERT INTO public.auditoria_do_painel
      (ator_tipo, ator_id, acao, entidade, entidade_id, de, para)
    VALUES (v_tipo, v_ator, v_acao, TG_TABLE_NAME, v_id,
            public.auditoria_sem_segredos(v_de), public.auditoria_sem_segredos(v_para));
  END IF;

  RETURN NULL;
END $$;

COMMENT ON FUNCTION registrar_auditoria_carteira_cliente() IS
  'Trigger próprio de clientes_carteira (ADR 0016 §3, bloqueador de merge): '
  'grava em auditoria quando clinica_id não é nulo, em auditoria_do_painel '
  'quando é — nunca tenta um INSERT com clinica_id NULL na tabela NOT NULL.';

DROP TRIGGER clientes_carteira_auditoria ON clientes_carteira;
CREATE TRIGGER clientes_carteira_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON clientes_carteira
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria_carteira_cliente();

-- ---------------------------------------------------------------------------
-- O trigger universal para tabela SEM `clinica_id` nenhum (`leads_comerciais`
-- e as demais tabelas novas de G5) — grava direto em `auditoria_do_painel`.
-- Diferente de `grupos`/`usuarios_gestao` (que escrevem a trilha À MÃO, via
-- `registrarNoPainel`, porque nasceram antes deste padrão): aqui o trigger é
-- automático desde o primeiro commit da tabela, porque a varredura de
-- `auditoria-inescapavel.test.ts` NÃO alcança tabela sem `clinica_id`
-- sozinha (ela varre por essa coluna) — sem o trigger aqui, "arquivar um
-- lead" teria `arquivado_em` preenchido e NENHUMA trilha de quem o fez (ADR
-- 0016 item 4).
-- ---------------------------------------------------------------------------
CREATE FUNCTION registrar_auditoria_do_painel() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_cru  text := coalesce(current_setting('app.pessoa_id', true), '');
  v_tipo text;
  v_ator uuid;
  v_old  jsonb;
  v_new  jsonb;
  v_de   jsonb;
  v_para jsonb;
  v_id   text;
BEGIN
  IF v_cru = '' THEN
    RAISE EXCEPTION 'ator não declarado: escrita em % recusada', TG_TABLE_NAME
      USING HINT = 'Use banco.nasTabelasDaCarteira*(ator, …).';
  END IF;

  SELECT tipo, ator INTO v_tipo, v_ator FROM auditoria_resolver_ator(v_cru);

  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;

  IF TG_OP = 'DELETE' THEN
    v_de := v_old; v_para := NULL; v_id := v_old ->> 'id';
  ELSIF TG_OP = 'INSERT' THEN
    v_de := NULL; v_para := v_new; v_id := v_new ->> 'id';
  ELSE
    SELECT jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k)
      INTO v_de, v_para
      FROM jsonb_object_keys(v_new) k
     WHERE v_old -> k IS DISTINCT FROM v_new -> k;
    IF v_para IS NULL THEN RETURN NULL; END IF;
    v_id := v_new ->> 'id';
  END IF;

  INSERT INTO public.auditoria_do_painel
    (ator_tipo, ator_id, acao, entidade, entidade_id, de, para)
  VALUES (
    v_tipo, v_ator,
    CASE TG_OP WHEN 'INSERT' THEN 'criou' WHEN 'UPDATE' THEN 'alterou' ELSE 'removeu' END,
    TG_TABLE_NAME, v_id,
    public.auditoria_sem_segredos(v_de),
    public.auditoria_sem_segredos(v_para));

  RETURN NULL;
END $$;

COMMENT ON FUNCTION registrar_auditoria_do_painel() IS
  'Trigger AFTER INSERT/UPDATE/DELETE para tabela de negócio SEM clinica_id '
  '(a carteira de G5 em diante). Mesmo papel de registrar_auditoria(), '
  'escrevendo em auditoria_do_painel em vez de auditoria.';

-- ---------------------------------------------------------------------------
-- PARTE 2 — `leads_comerciais`
-- ---------------------------------------------------------------------------

CREATE TABLE leads_comerciais (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        text NOT NULL,
  -- Nullable: a maioria dos leads não pertence a grupo nenhum ainda (spec
  -- §2.1, §6.1) — colapsar com clientes_carteira.grupo_id NOT NULL exigiria
  -- um grupo "placeholder" que a ADR 0011 já recusou por escrito.
  grupo_id    uuid REFERENCES grupos(id),
  responsavel_usuario_gestao_id uuid REFERENCES usuarios_gestao(id),
  origem      text NOT NULL,
  etapa       text NOT NULL DEFAULT 'novo'
                CHECK (etapa IN ('novo', 'contato', 'reuniao', 'proposta', 'espera', 'ganho', 'perdido')),
  temperatura text NOT NULL CHECK (temperatura IN ('frio', 'morno', 'quente')),
  produto_interesse text,
  proximo_contato   date,
  cliente_carteira_id uuid REFERENCES clientes_carteira(id),
  motivo_perda      text,
  fechado_em        timestamptz,
  -- "Excluir" na tela é "Arquivar" (regra 20/27) — nunca DELETE de verdade.
  arquivado_em      timestamptz,
  criado_em         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT leads_motivo_obrigatorio_quando_perdido
    CHECK (etapa <> 'perdido' OR motivo_perda IS NOT NULL),
  CONSTRAINT leads_cliente_so_quando_ganho
    CHECK ((etapa = 'ganho') = (cliente_carteira_id IS NOT NULL)),
  -- regra 27 aplicada (spec §6.3): um lead já convertido nunca é arquivado —
  -- "arquivar" é para registro incorreto (duplicata, teste), não para
  -- desfazer uma conversão que já criou um Cliente Firmare.
  CONSTRAINT leads_nao_arquiva_convertido
    CHECK (NOT (arquivado_em IS NOT NULL AND cliente_carteira_id IS NOT NULL))
);

COMMENT ON TABLE leads_comerciais IS
  'O funil de prospecção B2B da Firmare (CONTEXT.md, "Lead comercial"). '
  'Nunca é um Cliente Firmare — campos e ciclo de vida próprios. "Excluir" '
  'na tela é arquivar (arquivado_em), nunca DELETE (regra 20/27).';

CREATE INDEX leads_comerciais_por_grupo ON leads_comerciais (grupo_id)
  WHERE arquivado_em IS NULL;
CREATE INDEX leads_comerciais_por_responsavel ON leads_comerciais (responsavel_usuario_gestao_id)
  WHERE arquivado_em IS NULL;

ALTER TABLE leads_comerciais ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads_comerciais FORCE  ROW LEVEL SECURITY;
CREATE POLICY leads_comerciais_por_grupo ON leads_comerciais
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

REVOKE ALL ON leads_comerciais FROM fir_app;
GRANT SELECT, INSERT, UPDATE ON leads_comerciais TO fir_carteira;

CREATE TRIGGER leads_comerciais_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON leads_comerciais
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria_do_painel();

-- ---------------------------------------------------------------------------
-- `interacoes_do_lead` — append-only (spec §7).
-- ---------------------------------------------------------------------------

CREATE TABLE interacoes_do_lead (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_comercial_id uuid NOT NULL REFERENCES leads_comerciais(id),
  -- Denormalizado do lead, só para a RLS (ADR 0012: toda tabela com RLS por
  -- grupo tem a própria coluna, nunca lê clinica_id/grupo_id cruzado via
  -- JOIN dentro da policy).
  grupo_id         uuid REFERENCES grupos(id),
  quando           timestamptz NOT NULL DEFAULT now(),
  canal            text NOT NULL,
  nota             text NOT NULL,
  por_usuario_gestao_id uuid NOT NULL REFERENCES usuarios_gestao(id)
);

COMMENT ON TABLE interacoes_do_lead IS
  'Histórico append-only de contato com o prospect (CONTEXT.md, "Interação '
  'do lead") — nunca editável nem apagável; é a justificativa de "por que '
  'perdemos esse".';

CREATE INDEX interacoes_do_lead_por_lead ON interacoes_do_lead (lead_comercial_id, quando DESC);
CREATE INDEX interacoes_do_lead_por_grupo ON interacoes_do_lead (grupo_id);

ALTER TABLE interacoes_do_lead ENABLE ROW LEVEL SECURITY;
ALTER TABLE interacoes_do_lead FORCE  ROW LEVEL SECURITY;
CREATE POLICY interacoes_do_lead_por_grupo ON interacoes_do_lead
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

REVOKE ALL ON interacoes_do_lead FROM fir_app;
GRANT SELECT, INSERT ON interacoes_do_lead TO fir_carteira;
REVOKE UPDATE, DELETE, TRUNCATE ON interacoes_do_lead FROM fir_carteira;

CREATE TRIGGER interacoes_do_lead_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON interacoes_do_lead
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria_do_painel();

-- ---------------------------------------------------------------------------
-- PARTE 3 — `rotinas_internas` e `tarefas_internas` (reaproveitam o
-- mecanismo de `Marcador de rotina` já existente no domínio FIR — spec §3).
-- ---------------------------------------------------------------------------

CREATE TABLE rotinas_internas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo       text NOT NULL,
  -- NULL = rotina da própria Firmare, não de um grupo específico (spec §7).
  grupo_id     uuid REFERENCES grupos(id),
  responsavel_usuario_gestao_id uuid REFERENCES usuarios_gestao(id),
  frequencia   text NOT NULL CHECK (frequencia IN ('diaria', 'semanal', 'mensal', 'vencimento', 'reuniao')),
  escopo_aplicacao text NOT NULL CHECK (escopo_aplicacao IN ('global', 'por_cliente')),
  passos       text[] NOT NULL DEFAULT '{}',
  ativa        boolean NOT NULL DEFAULT true,
  inicio       date NOT NULL,
  criado_em    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE rotinas_internas IS
  'A definição recorrente que gera tarefas_internas sozinha (CONTEXT.md, '
  '"Rotina interna") — o análogo do Marcador de rotina já existente no '
  'domínio FIR, generalizado para a carteira.';

CREATE INDEX rotinas_internas_por_grupo ON rotinas_internas (grupo_id) WHERE ativa;

ALTER TABLE rotinas_internas ENABLE ROW LEVEL SECURITY;
ALTER TABLE rotinas_internas FORCE  ROW LEVEL SECURITY;
CREATE POLICY rotinas_internas_por_grupo ON rotinas_internas
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

REVOKE ALL ON rotinas_internas FROM fir_app;
GRANT SELECT, INSERT, UPDATE ON rotinas_internas TO fir_carteira;

CREATE TRIGGER rotinas_internas_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON rotinas_internas
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria_do_painel();

CREATE TABLE tarefas_internas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo      text NOT NULL,
  descricao   text,
  grupo_id    uuid REFERENCES grupos(id),
  responsavel_usuario_gestao_id uuid REFERENCES usuarios_gestao(id),
  cliente_carteira_id uuid REFERENCES clientes_carteira(id),
  lead_comercial_id   uuid REFERENCES leads_comerciais(id),
  prazo       date NOT NULL,
  prioridade  text NOT NULL DEFAULT 'normal' CHECK (prioridade IN ('baixa', 'normal', 'alta')),
  -- Só três estados — SEM a Jornada de nove etapas: aquele maquinário existe
  -- para o agendamento clínico, não para "ligar para o cliente X" (spec §3).
  status      text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'concluida', 'cancelada')),
  concluida_em timestamptz,
  rotina_interna_id uuid REFERENCES rotinas_internas(id),
  criado_em   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE tarefas_internas IS
  'O item de rotina da equipe Firmare sobre a carteira (CONTEXT.md, "Tarefa '
  'interna") — análogo de Tarefa, sem Jornada de nove etapas.';

CREATE INDEX tarefas_internas_por_grupo ON tarefas_internas (grupo_id) WHERE status = 'pendente';
CREATE INDEX tarefas_internas_por_responsavel ON tarefas_internas (responsavel_usuario_gestao_id)
  WHERE status = 'pendente';

-- O `Marcador de rotina interna` (spec §3): idempotência da geração por
-- `UNIQUE` entre as tarefas VIVAS. Dois índices parciais, não um só com
-- `coalesce(cliente_carteira_id, '00000000-…')`: NULL não repete em índice
-- único do Postgres (cada NULL é distinto de outro), então uma rotina
-- `global` (cliente_carteira_id sempre NULL) duplicaria livremente sem a
-- segunda forma abaixo — e um UUID sentinela para "sem cliente" seria a
-- mesma classe de atalho que a clínica/grupo sentinela já recusou.
CREATE UNIQUE INDEX tarefas_internas_marcador_por_cliente
  ON tarefas_internas (rotina_interna_id, prazo, cliente_carteira_id)
  WHERE status <> 'cancelada' AND cliente_carteira_id IS NOT NULL AND rotina_interna_id IS NOT NULL;
CREATE UNIQUE INDEX tarefas_internas_marcador_global
  ON tarefas_internas (rotina_interna_id, prazo)
  WHERE status <> 'cancelada' AND cliente_carteira_id IS NULL AND rotina_interna_id IS NOT NULL;

ALTER TABLE tarefas_internas ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarefas_internas FORCE  ROW LEVEL SECURITY;
CREATE POLICY tarefas_internas_por_grupo ON tarefas_internas
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

REVOKE ALL ON tarefas_internas FROM fir_app;
GRANT SELECT, INSERT, UPDATE ON tarefas_internas TO fir_carteira;

CREATE TRIGGER tarefas_internas_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON tarefas_internas
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria_do_painel();

-- ---------------------------------------------------------------------------
-- PARTE 4 — `checkins_internos`. Qualitativo nesta fatia (spec §4): sem
-- `meta_id`/`valor` — G3 ainda não existe. `saude_cliente` é sempre DERIVADA
-- do checkin mais recente (packages/domain, `saudeAtualDoCliente`), nunca um
-- campo solto em `clientes_carteira`.
-- ---------------------------------------------------------------------------

CREATE TABLE checkins_internos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_carteira_id uuid NOT NULL REFERENCES clientes_carteira(id),
  -- Denormalizado do cliente, só para a RLS — mesma razão de
  -- interacoes_do_lead.grupo_id acima.
  grupo_id    uuid REFERENCES grupos(id),
  -- ISO-8601 'yyyy-Www' (packages/domain, `semanaIsoCivil`) — nunca uma data
  -- solta: "a semana do checkin" é a unidade de negócio do ritual.
  semana      text NOT NULL CHECK (semana ~ '^\d{4}-W\d{2}$'),
  nota        text NOT NULL,
  saude       text NOT NULL CHECK (saude IN ('bom', 'atencao', 'critico')),
  por_usuario_gestao_id uuid NOT NULL REFERENCES usuarios_gestao(id),
  rotina_interna_id     uuid REFERENCES rotinas_internas(id),
  criado_em   timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT checkins_internos_uma_por_semana UNIQUE (cliente_carteira_id, semana)
);

COMMENT ON TABLE checkins_internos IS
  'O registro de que o acompanhamento periódico de um Cliente Firmare '
  'aconteceu (CONTEXT.md, "Checkin interno") — qualitativo nesta fatia, sem '
  'meta_id/valor (G3). Editável só na semana corrente (servidor confere, '
  'packages/domain `podeEditarCheckinDaSemana` — mesma disciplina de um '
  'fechamento por dia do Caixa, aplicada à semana aqui).';

CREATE INDEX checkins_internos_por_cliente ON checkins_internos (cliente_carteira_id, semana DESC);
CREATE INDEX checkins_internos_por_grupo ON checkins_internos (grupo_id);

ALTER TABLE checkins_internos ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins_internos FORCE  ROW LEVEL SECURITY;
CREATE POLICY checkins_internos_por_grupo ON checkins_internos
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

REVOKE ALL ON checkins_internos FROM fir_app;
GRANT SELECT, INSERT, UPDATE ON checkins_internos TO fir_carteira;

CREATE TRIGGER checkins_internos_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON checkins_internos
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria_do_painel();

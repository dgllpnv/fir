-- ---------------------------------------------------------------------------
-- G6 — FUNDAÇÃO DO PORTAL DO GRUPO. Spec:
-- docs/superpowers/plans/g6-spec-portal-do-grupo.md. Gates: ADR 0017 (LGPD,
-- base legal) e ADR 0018 (isolamento — critérios 9-13 são obrigatórios).
--
-- `Usuário do portal` é um QUARTO espaço de identidade (depois de `Pessoa`,
-- `Operador`, `Usuário de Gestão`) — do lado do CLIENTE da Firmare, nunca da
-- Firmare. Tabela própria, papel de banco próprio (`fir_portal`), cookie
-- próprio (`__Host-fir-portal`), tentativa/sessão próprias — ADR 0018 §3
-- exige a MESMA forma de `fir_carteira`/`fir_painel`, nunca um padrão novo.
--
-- Esta migration cobre a FUNDAÇÃO (§1.2 do spec): identidade, RLS por
-- `grupo_id`/`cliente_carteira_id`, e as três tabelas que G6 herda de
-- modelar (`documentos_carteira`, `materiais_carteira`, `reunioes_
-- comerciais` — spec §5). NÃO cobre: criação de conta pelo Operador/Usuário
-- de Gestão em TELA (fica no serviço da aplicação, `portal-admin.service.ts`),
-- nem o job que populará `campanhas_carteira.orcamentos_pagos` (G4, ainda não
-- escrito) — até lá, a leitura trata a contagem ausente como "suprimir",
-- nunca como "mostrar" (ver `packages/domain/src/portal-grupo.ts`).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- O PAPEL PRECISA EXISTIR, E PRECISA SER COMUM. Cópia do boot-check de 0025.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fir_portal') THEN
    RAISE EXCEPTION 'o papel fir_portal não existe'
      USING HINT = 'Local: rode `fir reset` depois de atualizar '
                   'infra/bootstrap-papeis.sql. Produção: provisione o papel '
                   'ANTES de migrar.';
  END IF;
  IF (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = 'fir_portal') THEN
    RAISE EXCEPTION 'fir_portal tem BYPASSRLS ou SUPERUSER'
      USING HINT = 'ADR 0018 §3.6: o portal NUNCA atravessa a RLS — ele fixa '
                   'app.portal_grupo_id/app.portal_cliente_id como qualquer '
                   'um. Corrija o papel e migre de novo.';
  END IF;
  IF (SELECT rolcreaterole FROM pg_roles WHERE rolname = 'fir_portal') THEN
    RAISE EXCEPTION 'fir_portal tem CREATEROLE'
      USING HINT = 'Com CREATEROLE o portal cria um papel com BYPASSRLS e '
                   'volta por ele. Tire o privilégio.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- `app_portal_grupo_id()` / `app_portal_cliente_id()` / `app_portal_pode_ver`
-- — ADR 0018 §1. `CASE...ELSE`, nunca `OR` na cláusula da POLICY: a decisão
-- mora inteira dentro da função (mesma defesa de `app_pode_ver_grupo`,
-- migration 0025), e é isso que faz `escopo='cliente'` ser estritamente mais
-- estreito que `escopo='grupo'` do MESMO grupo (ADR 0018 §1 item 3) — quando
-- `app_portal_cliente_id()` não é nulo, o ramo de grupo nunca é avaliado.
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_portal_grupo_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.portal_grupo_id', true), '')::uuid $$;

COMMENT ON FUNCTION app_portal_grupo_id() IS
  'O grupo fixado na sessão do Usuário do portal com escopo=grupo. NULL para '
  'escopo=cliente e para qualquer sessão que não seja do portal. Fixado pelo '
  'PortalGuard a partir de usuarios_do_portal.grupo_id — nunca de parâmetro '
  'de requisição (ADR 0018 §1 item 1).';

CREATE FUNCTION app_portal_cliente_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.portal_cliente_id', true), '')::uuid $$;

COMMENT ON FUNCTION app_portal_cliente_id() IS
  'O Cliente Firmare fixado na sessão do Usuário do portal com '
  'escopo=cliente. NULL para escopo=grupo. Fixado pelo PortalGuard a partir '
  'de usuarios_do_portal.cliente_carteira_id — nunca de parâmetro de '
  'requisição (ADR 0018 §1 item 1).';

CREATE FUNCTION app_portal_pode_ver(alvo_grupo uuid, alvo_cliente uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT coalesce(
      CASE
        WHEN app_portal_cliente_id() IS NULL THEN alvo_grupo = app_portal_grupo_id()
        ELSE alvo_cliente = app_portal_cliente_id()
      END,
      false
    )
  $$;

COMMENT ON FUNCTION app_portal_pode_ver(uuid, uuid) IS
  'A decisão de acesso do Usuário do portal (ADR 0018 §1). escopo=cliente vê '
  'só o próprio Cliente Firmare, mesmo que outro cliente pertença ao MESMO '
  'grupo (ramo ELSE nunca avalia o grupo); escopo=grupo vê todos os clientes '
  'daquele grupo. Toda policy de tabela comercial lida pelo portal chama '
  'esta função — nunca repete o CASE inline.';

-- ---------------------------------------------------------------------------
-- `usuarios_do_portal` — o ator. Mesma forma de `usuarios_gestao` (0025),
-- com DOIS escopos em vez de `geral`/`grupo`: não existe `escopo='geral'`
-- para este ator (spec §1.2 — "ninguém do lado de fora da Firmare enxerga a
-- carteira inteira").
-- ---------------------------------------------------------------------------
CREATE TABLE usuarios_do_portal (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario             text NOT NULL UNIQUE,
  nome                text NOT NULL,
  senha_hash          text NOT NULL,
  escopo              text NOT NULL CHECK (escopo IN ('cliente', 'grupo')),
  cliente_carteira_id uuid REFERENCES clientes_carteira(id),
  grupo_id            uuid REFERENCES grupos(id),
  ativo               boolean NOT NULL DEFAULT true,
  senha_provisoria    boolean NOT NULL DEFAULT false,
  senha_provisoria_expira_em timestamptz,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usuarios_do_portal_usuario_canonico CHECK (
    usuario = normalizar_nome(usuario)
    AND usuario ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
    AND length(usuario) BETWEEN 3 AND 32
  ),
  -- Exatamente um dos dois, conforme o escopo — nunca os dois, nunca nenhum
  -- (spec §1.2, mesmo CHECK de usuarios_gestao.escopo_grupo, um nível abaixo).
  CONSTRAINT usuarios_do_portal_escopo_exclusivo CHECK (
    (escopo = 'cliente') = (cliente_carteira_id IS NOT NULL)
    AND (escopo = 'grupo') = (grupo_id IS NOT NULL)
  ),
  CONSTRAINT usuarios_do_portal_provisoria_tem_prazo
    CHECK (NOT senha_provisoria OR senha_provisoria_expira_em IS NOT NULL)
);

COMMENT ON TABLE usuarios_do_portal IS
  'O ator do PORTAL DO GRUPO (CONTEXT.md, "Usuário do portal") — read-only, '
  'do lado do Cliente Firmare. escopo=cliente só é criado pelo Usuário de '
  'Gestão responsável; escopo=grupo só pelo Operador (spec §1.3) — a '
  'aplicação cobra essa regra, não há RLS nesta tabela (mesma forma de '
  'usuarios_gestao: protegida só por REVOKE de fir_app).';

COMMENT ON COLUMN usuarios_do_portal.ativo IS
  'Desativar aqui bloqueia a PRÓXIMA requisição (mesma régua P-12 de '
  'usuarios_gestao) — o guard confere isto a cada chamada, nunca só no login.';

-- `sessoes_do_portal`/`tentativas_do_portal` — TABELAS PRÓPRIAS (ADR 0018
-- §3: nunca reaproveitar as da carteira). Mesma forma de
-- `sessoes_de_carteira`/`tentativas_de_carteira` (0027/0029).
CREATE TABLE sessoes_do_portal (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_portal_id   uuid NOT NULL REFERENCES usuarios_do_portal(id),
  token_hash          text NOT NULL UNIQUE,
  criada_em           timestamptz NOT NULL DEFAULT now(),
  expira_em           timestamptz NOT NULL,
  revogada_em         timestamptz
);
CREATE INDEX sessoes_do_portal_vivas ON sessoes_do_portal (usuario_portal_id)
  WHERE revogada_em IS NULL;

COMMENT ON TABLE sessoes_do_portal IS
  'Sessão do Usuário do portal. Revogação é ativo=false em usuarios_do_portal '
  'OU revogada_em aqui — o guard confere as DUAS a cada requisição.';

CREATE TABLE tentativas_do_portal (
  id            bigserial PRIMARY KEY,
  identificador text NOT NULL,
  em            timestamptz NOT NULL DEFAULT now(),
  sucesso       boolean NOT NULL
);
CREATE INDEX tentativas_do_portal_recentes ON tentativas_do_portal (identificador, em DESC);

-- ---------------------------------------------------------------------------
-- O QUARTO ATOR NA TRILHA. `auditoria.ator_tipo` ganha 'usuario_portal', ao
-- lado de 'pessoa', 'operador', 'usuario_gestao' e 'sistema' — mesmo
-- movimento da 0025 para 'usuario_gestao' (ADR 0017 §5 item 2: nunca
-- reaproveitar um ator_tipo existente, isso esconderia que foi o CLIENTE,
-- não a própria equipe, quem leu).
-- ---------------------------------------------------------------------------
ALTER TABLE auditoria DROP CONSTRAINT auditoria_ator_tipo_check;
ALTER TABLE auditoria ADD CONSTRAINT auditoria_ator_tipo_check
  CHECK (ator_tipo IN ('pessoa', 'operador', 'usuario_gestao', 'usuario_portal', 'sistema'));

-- `registrar_auditoria()`: corpo inteiro copiado da 0025 (que copiou da 0013,
-- que copiou da 0004), com o ramo novo. `CREATE OR REPLACE` exige o corpo
-- inteiro — editar uma migration já aplicada reescreveria o passado.
--
-- O portal é READ-ONLY (ADR 0018 §4): nenhuma tabela de negócio hoje recebe
-- escrita de `usuario_portal:<id>`, e por isso este ramo nunca dispara na
-- prática. Ele entra mesmo assim, pela MESMA razão que 'usuario_gestao:' já
-- entrou antes de G5 escrever a primeira linha com ele (0025) — se um dia
-- aparecer uma escrita legítima do portal (fora do escopo de G6, ADR 0018
-- §4), a trigger já reconhece o ator, em vez de recusar a escrita por um
-- "ator não declarado" que confundiria a causa real.
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
  ELSIF v_cru = 'sistema' THEN
    v_tipo := 'sistema';
    v_ator := NULL;
  ELSIF left(v_cru, 9) = 'operador:' THEN
    v_tipo := 'operador';
    v_ator := substr(v_cru, 10)::uuid;
  ELSIF left(v_cru, 15) = 'usuario_gestao:' THEN
    v_tipo := 'usuario_gestao';
    v_ator := substr(v_cru, 16)::uuid;
  ELSIF left(v_cru, 15) = 'usuario_portal:' THEN
    v_tipo := 'usuario_portal';
    v_ator := substr(v_cru, 16)::uuid;
  ELSE
    v_tipo := 'pessoa';
    v_ator := v_cru::uuid;
  END IF;

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

COMMENT ON FUNCTION registrar_auditoria() IS
  'Trigger AFTER INSERT/UPDATE/DELETE de toda tabela de negócio. RECUSA a '
  'escrita quando ninguém declarou ator. Cinco atores: pessoa (uuid cru), '
  'sistema, operador do painel (operador:<uuid>), usuário de gestão da '
  'carteira (usuario_gestao:<uuid>) e usuário do portal (usuario_portal:<uuid>) '
  '— os três últimos gravam na trilha DA CLÍNICA em que operam.';

-- ---------------------------------------------------------------------------
-- O REGISTRO DE ACESSO do portal (ADR 0017 §5 / ADR 0018 critério 5) usa a
-- MESMA `auditoria` por clínica, pela mesma rota direta de
-- `AuditoriaService.registrarAcesso` (a trigger não vê SELECT) — nenhuma
-- tabela nova aqui. `banco/ator.ts` ganha o quarto ator (`UsuarioPortalId`)
-- do lado do TypeScript, e `AuditoriaService.registrarAcesso` já aceita
-- qualquer `Ator`.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- `campanhas_carteira.orcamentos_pagos` — EXPAND. Falta desde a 0028: a
-- supressão por reidentificação (ADR 0013 §4) precisa da contagem de
-- orçamentos pagos POR CAMPANHA, e `campanhas_carteira` só sincronizava
-- `receita` (ADR 0013 §5). NULL até o job de sincronização (G4, ainda não
-- escrito) a preencher — e `null` é tratado como "abaixo do limiar" pela
-- leitura do portal (packages/domain/src/portal-grupo.ts,
-- `deveSuprimirCampanha`), nunca como "sem limite": a leitura mais segura
-- enquanto a contagem real não chega é esconder, nunca mostrar.
-- ---------------------------------------------------------------------------
ALTER TABLE campanhas_carteira
  ADD COLUMN orcamentos_pagos int CHECK (orcamentos_pagos IS NULL OR orcamentos_pagos >= 0);

COMMENT ON COLUMN campanhas_carteira.orcamentos_pagos IS
  'Quantos orçamentos pagos a campanha reuniu — a contagem que decide a '
  'supressão por reidentificação (ADR 0013 §4, k=5). NULL até o job de G4 '
  'sincronizar; tratado como "suprimir" pela leitura do portal, nunca como '
  '"mostrar sem limite".';

-- ---------------------------------------------------------------------------
-- `documentos_carteira` / `materiais_carteira` / `reunioes_comerciais` — as
-- três tabelas que G6 herda de modelar (spec §0 "achado colateral de
-- escopo", §5). Mesma forma de `campanhas_carteira`: sem `clinica_id`,
-- `cliente_carteira_id NOT NULL` + `grupo_id NOT NULL` denormalizado (RLS por
-- grupo, ADR 0012/0018).
--
-- SIMPLIFICAÇÃO DELIBERADA, registrada aqui para quem for desarquivá-la:
-- `materiais_carteira` nasce SEMPRE ligado a um `Cliente Firmare`
-- (`cliente_carteira_id NOT NULL`) — a "biblioteca geral, sem cliente" que o
-- spec também descreve (`programas text[]`, sem `personalizado_para`) fica
-- de fora desta fatia. G6 não tem um caso de uso concreto para ela ainda, e
-- construir a tabela com uma coluna sempre nula seria exatamente a
-- abstração sem uso que o CLAUDE.md pede para não construir. Quando houver
-- pedido real, a extensão é EXPAND: `cliente_carteira_id` vira nullable, e a
-- policy de leitura do portal passa a liberar `grupo_id IS NULL` também.
-- ---------------------------------------------------------------------------
CREATE TABLE documentos_carteira (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_carteira_id uuid NOT NULL REFERENCES clientes_carteira(id),
  grupo_id            uuid NOT NULL REFERENCES grupos(id),
  titulo              text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 160),
  categoria           text NOT NULL,
  link                text NOT NULL CHECK (length(btrim(link)) BETWEEN 1 AND 2000),
  data                date NOT NULL,
  -- O filtro de visibilidade é de LEITURA do portal — nunca uma segunda
  -- tabela (critério de aceite 8 do spec G6 §6).
  visivel_portal      boolean NOT NULL DEFAULT true,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  criado_por          uuid NOT NULL REFERENCES usuarios_gestao(id)
);

COMMENT ON TABLE documentos_carteira IS
  'Documento da carteira (CONTEXT.md): link (tipicamente Drive) cadastrado '
  'pela Firmare sobre um Cliente Firmare. visivel_portal controla só a '
  'LEITURA pelo portal — a equipe interna sempre vê tudo.';

CREATE INDEX documentos_carteira_por_cliente ON documentos_carteira (cliente_carteira_id, data DESC);

ALTER TABLE documentos_carteira ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos_carteira FORCE  ROW LEVEL SECURITY;

CREATE POLICY documentos_carteira_carteira ON documentos_carteira
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

-- Restrita A `fir_portal` (cláusula `TO`): não compõe por OR com a policy
-- acima para `fir_carteira` — cada papel só é sujeito à SUA policy (ADR 0018
-- item 2, "nenhuma política nova em espécie" — aqui é a MESMA forma, um
-- papel a mais). `visivel_portal` entra por AND, nunca por OR.
CREATE POLICY documentos_carteira_portal ON documentos_carteira
  FOR SELECT TO fir_portal
  USING (visivel_portal AND app_portal_pode_ver(grupo_id, cliente_carteira_id));

REVOKE ALL ON documentos_carteira FROM fir_app;
GRANT SELECT, INSERT, UPDATE ON documentos_carteira TO fir_carteira;
GRANT SELECT ON documentos_carteira TO fir_portal;

CREATE TABLE materiais_carteira (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_carteira_id uuid NOT NULL REFERENCES clientes_carteira(id),
  grupo_id            uuid NOT NULL REFERENCES grupos(id),
  titulo              text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 160),
  tipo                text NOT NULL,
  descricao           text,
  link                text CHECK (link IS NULL OR length(btrim(link)) BETWEEN 1 AND 2000),
  visivel_portal      boolean NOT NULL DEFAULT true,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  criado_por          uuid NOT NULL REFERENCES usuarios_gestao(id)
);

COMMENT ON TABLE materiais_carteira IS
  'Material da carteira (CONTEXT.md): item da biblioteca "Método Firmare" '
  'personalizado a um Cliente Firmare. A biblioteca GERAL (sem cliente) fica '
  'fora desta fatia — ver o comentário acima da seção.';

CREATE INDEX materiais_carteira_por_cliente ON materiais_carteira (cliente_carteira_id, criado_em DESC);

ALTER TABLE materiais_carteira ENABLE ROW LEVEL SECURITY;
ALTER TABLE materiais_carteira FORCE  ROW LEVEL SECURITY;

CREATE POLICY materiais_carteira_carteira ON materiais_carteira
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

CREATE POLICY materiais_carteira_portal ON materiais_carteira
  FOR SELECT TO fir_portal
  USING (visivel_portal AND app_portal_pode_ver(grupo_id, cliente_carteira_id));

REVOKE ALL ON materiais_carteira FROM fir_app;
GRANT SELECT, INSERT, UPDATE ON materiais_carteira TO fir_carteira;
GRANT SELECT ON materiais_carteira TO fir_portal;

CREATE TABLE reunioes_comerciais (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_carteira_id uuid NOT NULL REFERENCES clientes_carteira(id),
  grupo_id            uuid NOT NULL REFERENCES grupos(id),
  data                date NOT NULL,
  resumo              text NOT NULL CHECK (length(btrim(resumo)) BETWEEN 1 AND 4000),
  encaminhamentos     text,
  anexos              jsonb,
  por_usuario_gestao_id uuid NOT NULL REFERENCES usuarios_gestao(id),
  criado_em           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE reunioes_comerciais IS
  'Reunião comercial (CONTEXT.md): ata/resumo de uma reunião da Firmare com '
  'um Cliente Firmare. SEM flag de visibilidade — ao contrário de documento '
  'e material, toda reunião registrada é visível ao portal (critério de '
  'aceite 8 do spec G6 trata documento/material; reunião não tem o mesmo '
  'botão na tela interna hoje). Revisitar se um pedido real exigir ocultar.';

CREATE INDEX reunioes_comerciais_por_cliente ON reunioes_comerciais (cliente_carteira_id, data DESC);

ALTER TABLE reunioes_comerciais ENABLE ROW LEVEL SECURITY;
ALTER TABLE reunioes_comerciais FORCE  ROW LEVEL SECURITY;

CREATE POLICY reunioes_comerciais_carteira ON reunioes_comerciais
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

CREATE POLICY reunioes_comerciais_portal ON reunioes_comerciais
  FOR SELECT TO fir_portal
  USING (app_portal_pode_ver(grupo_id, cliente_carteira_id));

REVOKE ALL ON reunioes_comerciais FROM fir_app;
GRANT SELECT, INSERT, UPDATE ON reunioes_comerciais TO fir_carteira;
GRANT SELECT ON reunioes_comerciais TO fir_portal;

-- ---------------------------------------------------------------------------
-- O PORTAL LÊ AS TABELAS COMERCIAIS JÁ EXISTENTES — spec §2.1: "a única
-- coisa nova é uma SEGUNDA FUNÇÃO", nunca uma política nova em espécie. Uma
-- policy `TO fir_portal` a mais em cada tabela, e SÓ SELECT no GRANT —
-- ADR 0018 critério 11: ausência de GRANT de escrita é a PRIMEIRA camada,
-- mais forte que a RLS.
-- ---------------------------------------------------------------------------
CREATE POLICY clientes_carteira_portal ON clientes_carteira
  FOR SELECT TO fir_portal
  USING (app_portal_pode_ver(grupo_id, id));

GRANT SELECT ON clientes_carteira TO fir_portal;

CREATE POLICY campanhas_carteira_portal ON campanhas_carteira
  FOR SELECT TO fir_portal
  USING (app_portal_pode_ver(grupo_id, cliente_carteira_id));

GRANT SELECT ON campanhas_carteira TO fir_portal;

CREATE POLICY indicadores_carteira_portal ON indicadores_carteira
  FOR SELECT TO fir_portal
  USING (app_portal_pode_ver(grupo_id, cliente_carteira_id));

GRANT SELECT ON indicadores_carteira TO fir_portal;

CREATE POLICY metas_comerciais_portal ON metas_comerciais
  FOR SELECT TO fir_portal
  USING (app_portal_pode_ver(grupo_id, cliente_carteira_id));

GRANT SELECT ON metas_comerciais TO fir_portal;

-- `lancamentos_de_indicador` — precisa ser lida para mostrar o progresso
-- DERIVADO da meta comercial (MetaComercialNaLista.ultimoLancamento, mesma
-- forma já usada pela leitura do Usuário de Gestão). RLS por grupo, mesma
-- função.
CREATE POLICY lancamentos_de_indicador_portal ON lancamentos_de_indicador
  FOR SELECT TO fir_portal
  USING (app_portal_pode_ver(grupo_id, (SELECT i.cliente_carteira_id FROM indicadores_carteira i WHERE i.id = indicador_id)));

GRANT SELECT ON lancamentos_de_indicador TO fir_portal;

CREATE POLICY cobrancas_do_cliente_firmare_portal ON cobrancas_do_cliente_firmare
  FOR SELECT TO fir_portal
  USING (app_portal_pode_ver(grupo_id, cliente_carteira_id));

GRANT SELECT ON cobrancas_do_cliente_firmare TO fir_portal;

-- `uso_diario_cliente` NÃO ganha policy de portal: é telemetria interna da
-- Firmare sobre o uso da ferramenta (ADR 0013 §3, legítimo interesse da
-- Firmare), fora do que o spec G6 §3.1 lista como exibido ao cliente.

-- ---------------------------------------------------------------------------
-- `usuarios_do_portal`/`sessoes_do_portal`/`tentativas_do_portal`: sem RLS
-- (mesma forma de `usuarios_gestao`/`sessoes_de_carteira`/`tentativas_de_
-- carteira` — protegidas só por REVOKE de fir_app, defesa em profundidade).
--
-- `fir_portal` precisa ler/escrever a PRÓPRIA sessão e a própria tentativa —
-- é o papel que atende o login do portal. `fir_carteira` precisa
-- ler/criar/desativar `usuarios_do_portal` — é por onde o Usuário de
-- Gestão/Operador administram contas do portal (nasTabelasDaCarteira*, a
-- MESMA conexão que já escreve usuarios_gestao).
-- ---------------------------------------------------------------------------
REVOKE ALL ON usuarios_do_portal, sessoes_do_portal, tentativas_do_portal FROM fir_app;

GRANT SELECT, INSERT, UPDATE ON usuarios_do_portal TO fir_carteira;
-- SÓ SELECT para fir_portal: a troca de senha no primeiro acesso (spec
-- §3.2, "detalhe de ticket, não decisão nova") não é parte de G6 núcleo —
-- `UPDATE` chega como EXPAND quando esse endpoint existir, nunca antes
-- (regra de menor privilégio: não conceder o verbo antes de haver rota que
-- o use).
GRANT SELECT ON usuarios_do_portal TO fir_portal;

GRANT SELECT, INSERT, UPDATE ON sessoes_do_portal TO fir_portal;
GRANT SELECT, INSERT ON tentativas_do_portal TO fir_portal;
GRANT USAGE, SELECT ON SEQUENCE tentativas_do_portal_id_seq TO fir_portal;

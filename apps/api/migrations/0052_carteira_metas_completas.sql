-- ===========================================================================
-- G8, TICKET 2B — metas completas, igual ao protótipo.
-- Inventário `docs/specs/g8-paridade-gestao-inventario.md` (M1–M4, M6, V8,
-- V10, O4; PP-2), gates `g8-gate-numeros.md` (CE-2, CE-4, CE-5, ajustes 16 a
-- 22), `g8-gate-appsec.md` (A-6, A-7, A-8, caso 12).
-- Protótipo: `versoes/firmare-gestao-prototipo/index.html` — `F.meta`
-- L2756-2761, `fAcao` L2767-2768, `F.indicador` L2763, `avaliarMeta`
-- L751-780, `fontesMeta`/`valorAtualMeta` L730-743.
--
-- Forward-only, EXPAND: só acrescenta coluna, valor permitido, tabela, view e
-- índice. As duas relaxações (`metas_comerciais.prazo` perde o NOT NULL;
-- `status` aceita os quatro estados do protótipo) são compatíveis com o
-- código anterior, que só grava `em_andamento` com prazo.
--
-- O QUE ESTA MIGRATION *NÃO* FAZ, DE PROPÓSITO (gate de números, ajuste 17):
-- o `CHECK (extract(isodow from referencia) = 1)` em
-- `lancamentos_de_indicador`. Produção já tem lançamentos gravados em outros
-- dias da semana (o contrato antigo aceitava qualquer `DiaCivil`), e o CHECK
-- quebraria a migration — ou, como `NOT VALID`, quebraria a primeira
-- correção de observação de uma linha antiga. A regra entra AGORA na
-- ENTRADA (o servidor recusa referência fora da segunda-feira em toda rota de
-- lançamento, CE-4), e os legados são listados pela view
-- `lancamentos_fora_da_segunda` abaixo, para reconciliação HUMANA (regra 27:
-- nada é fundido nem movido automaticamente). O CHECK é o passo CONTRACT, num
-- release seguinte, quando a view devolver zero linhas em produção.
-- ===========================================================================

SELECT set_config('app.pessoa_id', 'sistema', true);


-- ---------------------------------------------------------------------------
-- PARTE 1 — Indicador: unidade "dias" e meta semanal (V10, `F.indicador`)
-- ---------------------------------------------------------------------------

-- "dias" entra no conjunto FECHADO (M2): inteiro, como "un". A função
-- `validar_valor_por_unidade` (0031) já trata toda unidade ≠ R$ como inteiro.
ALTER TABLE indicadores_carteira DROP CONSTRAINT indicadores_carteira_unidade_check;
ALTER TABLE indicadores_carteira
  ADD CONSTRAINT indicadores_carteira_unidade_check CHECK (unidade IN ('R$', 'un', '%', 'dias'));

-- "Meta semanal" do indicador (L2763, `cIndicadoresManual` L1522-1527). O
-- mesmo par centavos/inteiro do lançamento (ADR 0015 achado 4); opcional —
-- sem meta, o cartão não mostra "Na meta" nem "Abaixo" (ajuste 22).
ALTER TABLE indicadores_carteira
  ADD COLUMN meta_centavos bigint,
  ADD COLUMN meta_inteiro  bigint,
  ADD COLUMN atualizado_em timestamptz,
  ADD CONSTRAINT indicadores_carteira_meta_um_so_tipo CHECK (meta_centavos IS NULL OR meta_inteiro IS NULL);

CREATE FUNCTION validar_meta_do_indicador() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.meta_centavos IS NOT NULL AND NEW.unidade <> 'R$' THEN
    RAISE EXCEPTION 'meta do indicador em centavos exige unidade R$ (indicador %)', NEW.id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.meta_inteiro IS NOT NULL AND NEW.unidade = 'R$' THEN
    RAISE EXCEPTION 'meta do indicador R$ precisa estar em centavos (indicador %)', NEW.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER indicadores_carteira_valida_meta
  BEFORE INSERT OR UPDATE ON indicadores_carteira
  FOR EACH ROW EXECUTE FUNCTION validar_meta_do_indicador();


-- ---------------------------------------------------------------------------
-- PARTE 2 — Meta: tipo, agregação, fonte e os quatro estados (M2, M5)
-- ---------------------------------------------------------------------------

ALTER TABLE metas_comerciais
  -- `mensal` recomeça todo mês; `prazo` acumula até a data final (L2758).
  -- As metas existentes (G3) são de prazo: têm início e prazo obrigatórios.
  ADD COLUMN tipo text NOT NULL DEFAULT 'prazo' CHECK (tipo IN ('mensal', 'prazo')),
  -- Como as semanas fecham o resultado (`AGREG`, L744). As metas de G3 liam
  -- o ÚLTIMO lançamento — o default preserva exatamente esse comportamento.
  ADD COLUMN agregacao text NOT NULL DEFAULT 'ultimo' CHECK (agregacao IN ('soma', 'media', 'ultimo')),
  -- De onde vem o resultado (`fontesMeta`, L730-735):
  --  * `lancamento` — o `Lançamento de indicador` semanal do PRÓPRIO
  --    indicador da meta (o `checkin` do protótipo, PP-2);
  --  * `indicador`  — o último lançamento de OUTRO indicador do mesmo cliente
  --    e da mesma unidade (`ind:<id>`, ajuste 20);
  --  * `planilha`   — uma métrica da planilha de indicadores
  --    (`pl:<frente>|<métrica>|<ultima|media4|soma4>`, ticket 4A).
  ADD COLUMN fonte text NOT NULL DEFAULT 'lancamento' CHECK (fonte IN ('lancamento', 'indicador', 'planilha')),
  ADD COLUMN fonte_indicador_id uuid REFERENCES indicadores_carteira(id),
  ADD COLUMN fonte_planilha text CHECK (fonte_planilha IS NULL OR fonte_planilha ~ '^pl:[a-z]+\|[^|]{1,80}\|(ultima|media4|soma4)$'),
  ADD COLUMN atualizado_em timestamptz,
  ADD CONSTRAINT metas_comerciais_fonte_coerente CHECK (
    (fonte = 'lancamento' AND fonte_indicador_id IS NULL AND fonte_planilha IS NULL) OR
    (fonte = 'indicador'  AND fonte_indicador_id IS NOT NULL AND fonte_planilha IS NULL) OR
    (fonte = 'planilha'   AND fonte_indicador_id IS NULL AND fonte_planilha IS NOT NULL)
  );

-- Meta mensal não tem prazo no protótipo (o campo fica vazio, L2761).
ALTER TABLE metas_comerciais ALTER COLUMN prazo DROP NOT NULL;

-- Os quatro estados do protótipo (`STATUS_META`, L513). `concluida` (G3)
-- continua ACEITO para as linhas existentes — a leitura o trata como
-- `atingida`, e nenhum código novo o grava. Sai num release seguinte
-- (contract), depois de um UPDATE com trilha.
ALTER TABLE metas_comerciais DROP CONSTRAINT metas_comerciais_status_check;
ALTER TABLE metas_comerciais
  ADD CONSTRAINT metas_comerciais_status_check
    CHECK (status IN ('em_andamento', 'atingida', 'nao_atingida', 'cancelada', 'concluida'));

-- O portal (G6) ainda lê `metas_comerciais` com a forma de G3: `prazo`
-- obrigatório e dois estados (`leitura-do-portal.service.ts`,
-- `apps/web/src/app/portal/clientes/page.tsx` formata `m.prazo` sem
-- conferir nulo). Até a O4 (a avaliação de M3 no portal) ser ligada lá, a
-- policy do portal mostra só o que aquela tela sabe desenhar — e nunca a meta
-- cancelada. `TO fir_portal` explícito (A-7, lição da 0035).
ALTER POLICY metas_comerciais_portal ON metas_comerciais
  TO fir_portal
  USING (app_portal_pode_ver(grupo_id, cliente_carteira_id) AND prazo IS NOT NULL AND status <> 'cancelada');

-- A meta e o cliente no mesmo grupo, pelo banco (A-8).
ALTER TABLE metas_comerciais
  ADD CONSTRAINT metas_comerciais_cliente_do_grupo
    FOREIGN KEY (cliente_carteira_id, grupo_id) REFERENCES clientes_carteira (id, grupo_id)
    ON UPDATE CASCADE NOT VALID;
ALTER TABLE metas_comerciais VALIDATE CONSTRAINT metas_comerciais_cliente_do_grupo;

CREATE UNIQUE INDEX metas_comerciais_id_cliente_unico ON metas_comerciais (id, cliente_carteira_id);


-- ---------------------------------------------------------------------------
-- PARTE 3 — Lançamentos fora da segunda-feira: o RELATÓRIO, não o CHECK
-- ---------------------------------------------------------------------------

-- `security_invoker`: a view roda com os privilégios e a RLS de quem
-- consulta — nunca com os do dono. Pelo papel da carteira, cada sessão vê só
-- os lançamentos do próprio grupo; pelo `fir_migrate` (o operador de
-- produção, via `fir psql`), vê todos. Ordenada por indicador, para a
-- reconciliação semana a semana.
CREATE VIEW lancamentos_fora_da_segunda WITH (security_invoker = true) AS
  SELECT l.id                                  AS lancamento_id,
         l.grupo_id,
         i.cliente_carteira_id,
         l.indicador_id,
         i.nome                                AS indicador,
         l.referencia,
         extract(isodow FROM l.referencia)::int AS dia_da_semana_iso,
         -- A segunda-feira da semana — onde o valor deveria morar.
         (l.referencia - (extract(isodow FROM l.referencia)::int - 1))::date AS segunda_da_semana,
         -- Já existe um lançamento NA segunda dessa semana? Então os dois
         -- contariam a semana duas vezes numa soma (CE-4): conflito a decidir.
         EXISTS (
           SELECT 1 FROM lancamentos_de_indicador o
            WHERE o.indicador_id = l.indicador_id
              AND o.referencia = (l.referencia - (extract(isodow FROM l.referencia)::int - 1))::date
         )                                     AS segunda_ja_lancada,
         l.criado_em
    FROM lancamentos_de_indicador l
    JOIN indicadores_carteira i ON i.id = l.indicador_id
   WHERE extract(isodow FROM l.referencia) <> 1;

COMMENT ON VIEW lancamentos_fora_da_segunda IS
  'Relatório de reconciliação do ajuste 17 do gate de números (G8 2B): '
  'lançamentos de indicador gravados antes da validação na entrada, com '
  'referência fora da segunda-feira. Não contém valor (regra 21). Cada linha '
  'é decidida por uma pessoa — mover para a segunda (se a segunda estiver '
  'livre) ou descartar —, nunca automaticamente (regra 27). Quando devolver '
  'zero linhas em produção, o CHECK (isodow = 1) entra numa migration nova.';

-- O ALTER DEFAULT PRIVILEGES do bootstrap dá INSERT/UPDATE/DELETE a `fir_app`
-- em toda relação nova; view não tem RLS própria (`escrita-sem-rls.test.ts`).
REVOKE ALL ON lancamentos_fora_da_segunda FROM PUBLIC;
REVOKE ALL ON lancamentos_fora_da_segunda FROM fir_app;
GRANT SELECT ON lancamentos_fora_da_segunda TO fir_carteira;


-- ---------------------------------------------------------------------------
-- PARTE 4 — `Ação do plano` (V8, `fAcao` L2767-2768, `tabelaAcoes` L1335)
-- ---------------------------------------------------------------------------

CREATE TABLE acoes_do_plano (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_carteira_id uuid NOT NULL,
  grupo_id            uuid NOT NULL REFERENCES grupos(id),
  titulo              text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 200),
  -- "Plano de ação" ou "Ação comercial" (L2767).
  tipo                text NOT NULL DEFAULT 'plano' CHECK (tipo IN ('plano', 'comercial')),
  -- "Meta vinculada" (opcional). FK composta: a meta é do MESMO cliente.
  meta_comercial_id   uuid,
  -- "Quem executa": a própria clínica ou a Firmare (L2768).
  quem_executa        text NOT NULL DEFAULT 'cliente' CHECK (quem_executa IN ('cliente', 'firmare')),
  -- "Acompanhamento Firmare": quem da equipe acompanha (L2768).
  acompanhamento_usuario_gestao_id uuid REFERENCES usuarios_gestao(id),
  prazo               date,
  status              text NOT NULL DEFAULT 'pendente'
                        CHECK (status IN ('pendente', 'em_andamento', 'concluida', 'cancelada')),
  descricao           text CHECK (descricao IS NULL OR length(descricao) <= 2000),
  concluida_em        timestamptz,
  criado_por          uuid NOT NULL REFERENCES usuarios_gestao(id),
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz,
  -- "Excluir" do protótipo vira arquivar (regra 20): a linha fica, a trilha também.
  arquivada_em        timestamptz,

  CONSTRAINT acoes_do_plano_cliente_do_grupo
    FOREIGN KEY (cliente_carteira_id, grupo_id) REFERENCES clientes_carteira (id, grupo_id)
    ON UPDATE CASCADE,
  CONSTRAINT acoes_do_plano_meta_do_cliente
    FOREIGN KEY (meta_comercial_id, cliente_carteira_id) REFERENCES metas_comerciais (id, cliente_carteira_id),
  CONSTRAINT acoes_do_plano_concluida_tem_instante CHECK ((status = 'concluida') = (concluida_em IS NOT NULL))
);

COMMENT ON TABLE acoes_do_plano IS
  'Ação do plano (G8 2B, V8): um passo do plano de ação ou uma ação comercial '
  'de um Cliente Firmare — título, tipo, meta vinculada, quem executa (a '
  'clínica ou a Firmare), acompanhamento, prazo e status. NÃO é Tarefa '
  'interna: a ação pode ser executada pela clínica, e é o que se mostra como '
  'plano. Não vai ao portal (o protótipo não a mostra lá, portal L94-173): '
  'nenhum GRANT a fir_portal. "Atrasada" é derivada (aberta e prazo < hoje), '
  'nunca um estado gravado.';

CREATE INDEX acoes_do_plano_por_cliente ON acoes_do_plano (cliente_carteira_id) WHERE arquivada_em IS NULL;
CREATE INDEX acoes_do_plano_por_grupo   ON acoes_do_plano (grupo_id) WHERE arquivada_em IS NULL;
CREATE INDEX acoes_do_plano_por_meta    ON acoes_do_plano (meta_comercial_id) WHERE meta_comercial_id IS NOT NULL;

ALTER TABLE acoes_do_plano ENABLE ROW LEVEL SECURITY;
ALTER TABLE acoes_do_plano FORCE  ROW LEVEL SECURITY;

CREATE POLICY acoes_do_plano_por_grupo ON acoes_do_plano
  TO fir_carteira
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

REVOKE ALL ON acoes_do_plano FROM PUBLIC;
REVOKE ALL ON acoes_do_plano FROM fir_app;
GRANT SELECT, INSERT, UPDATE ON acoes_do_plano TO fir_carteira;

-- O acompanhamento é alguém da equipe que enxerga o grupo da ação: de
-- escopo geral, ou do mesmo grupo (mesma regra do responsável do cliente, 0047).
CREATE FUNCTION acoes_do_plano_acompanhamento_do_grupo() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_escopo text;
  v_grupo  uuid;
BEGIN
  IF NEW.acompanhamento_usuario_gestao_id IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR NEW.acompanhamento_usuario_gestao_id IS DISTINCT FROM OLD.acompanhamento_usuario_gestao_id) THEN
    SELECT u.escopo, u.grupo_id INTO v_escopo, v_grupo
      FROM usuarios_gestao u WHERE u.id = NEW.acompanhamento_usuario_gestao_id;
    IF v_escopo IS NULL OR (v_escopo <> 'geral' AND v_grupo IS DISTINCT FROM NEW.grupo_id) THEN
      RAISE EXCEPTION 'o acompanhamento da ação precisa enxergar o grupo dela'
        USING ERRCODE = '23514', CONSTRAINT = 'acoes_do_plano_acompanhamento_do_grupo';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER acoes_do_plano_acompanhamento_do_grupo
  BEFORE INSERT OR UPDATE ON acoes_do_plano
  FOR EACH ROW EXECUTE FUNCTION acoes_do_plano_acompanhamento_do_grupo();

-- Trilha de escrita (regra 20): quem, quando, de → para, pelo ator da sessão.
CREATE TRIGGER acoes_do_plano_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON acoes_do_plano
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria_do_painel();

-- ---------------------------------------------------------------------------
-- G1a — FUNDAÇÃO DA CARTEIRA COMERCIAL DA FIRMARE. ADRs 0011, 0012, 0013.
--
-- NÃO TOCA `clinicas`. `grupo_id NOT NULL` em `clinicas` é G1b, e G1b espera
-- o FIM LITERAL do épico 9 (corte das 4 clínicas + janela de v20 em paralelo
-- encerrada) — não apenas a paridade ficar verde. Ver
-- `docs/superpowers/plans/2026-11-05-plano-integracao-firmare-gestao.md` §1.6
-- e o achado de `product-rotina-clinica` no gate de risco.
--
-- `Grupo`, `Usuário de Gestão` e `Histórico de grupo da clínica` não são uma
-- `Pessoa` nem um `Operador` (CONTEXT.md, seção "Carteira comercial da
-- Firmare"). Mesma forma do painel (migration 0013): tabela própria, sem
-- `clinica_id`, terceiro papel de banco, boot check que falha alto.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- O PAPEL PRECISA EXISTIR, E PRECISA SER COMUM. Cópia do padrão de 0013.
--
-- `fir_carteira` nasce no bootstrap (local) ou no provisionamento de produção
-- — nunca aqui: `fir_migrate` não tem `CREATEROLE`.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fir_carteira') THEN
    RAISE EXCEPTION 'o papel fir_carteira não existe'
      USING HINT = 'Local: rode `fir reset` depois de atualizar '
                   'infra/bootstrap-papeis.sql. Produção: provisione o papel '
                   'ANTES de migrar.';
  END IF;
  IF (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = 'fir_carteira') THEN
    RAISE EXCEPTION 'fir_carteira tem BYPASSRLS ou SUPERUSER'
      USING HINT = 'ADR 0012: a carteira NUNCA atravessa a RLS — ela fixa '
                   'app.grupo_id/app.escopo como qualquer um. Corrija o papel '
                   'e migre de novo.';
  END IF;
  IF (SELECT rolcreaterole FROM pg_roles WHERE rolname = 'fir_carteira') THEN
    RAISE EXCEPTION 'fir_carteira tem CREATEROLE'
      USING HINT = 'Com CREATEROLE a carteira cria um papel com BYPASSRLS e '
                   'volta por ele. Tire o privilégio.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- `app_grupo_id()` e `app_escopo()` — mesma forma de `app_clinica_id()`
-- (0001). Não protegem tabela nenhuma ainda (G1a não cria tabela com
-- `grupo_id` de negócio); existem agora para que G2/G4 as usem sem precisar
-- de migration própria para a função (ADR 0012).
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_grupo_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.grupo_id', true), '')::uuid $$;

COMMENT ON FUNCTION app_grupo_id() IS
  'O grupo fixado na sessão do Usuário de Gestão com escopo=grupo. NULL para '
  'escopo=geral (superadmin) e para qualquer sessão que não seja da carteira.';

CREATE FUNCTION app_escopo() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.escopo', true), '') $$;

COMMENT ON FUNCTION app_escopo() IS
  '''geral'' ou ''grupo'', fixado pelo guard de autenticação da carteira a '
  'partir de usuarios_gestao.escopo — nunca escolhido pela requisição.';

-- `app_pode_ver_grupo(alvo)` — a decisão de acesso por grupo, numa função só.
--
-- `teste/isolamento-de-clinica.test.ts` já prova, por mutação ao vivo, que
-- `OR` dentro de uma policy é perigoso: `USING (clinica_id = app_clinica_id()
-- OR true)` continua "contendo app_clinica_id" e abre a tabela inteira. A
-- defesa de lá é proibir `OR` na cláusula, ponto. Em vez de inliner o mesmo
-- risco para grupo (`grupo_id = app_grupo_id() OR app_escopo() = 'geral'`),
-- a decisão vira UMA função — mesma forma de `temPerm` em
-- `packages/domain/permissoes.ts` ("uma função só, nunca um if espalhado").
-- A policy chama a função; o `OR` mora dentro dela, testável e auditável num
-- lugar só, nunca visível (e nunca contornável) na cláusula da policy.
CREATE FUNCTION app_pode_ver_grupo(alvo uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(app_escopo() = 'geral' OR alvo = app_grupo_id(), false) $$;

COMMENT ON FUNCTION app_pode_ver_grupo(uuid) IS
  'A decisão de acesso por grupo da carteira (ADR 0012). geral vê qualquer '
  'grupo; grupo vê só o próprio. Toda policy de tabela com RLS por grupo '
  'chama esta função — nunca repete o OR inline.';

-- ---------------------------------------------------------------------------
-- `grupos` — o vínculo comercial estável (ADR 0011 item 1). Sem `clinica_id`:
-- é a Clínica que vai apontar para ELE (G1b), nunca o contrário.
-- ---------------------------------------------------------------------------
CREATE TABLE grupos (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome      text NOT NULL,
  ativo     boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE grupos IS
  'Vínculo comercial estável entre a Firmare e um conjunto de clínicas. Fato '
  'de tenancy, nunca concessão (ver Concessão de consultoria, CONTEXT.md). '
  'Não existe uma linha "GERAL": a visão total do superadmin é app_escopo() '
  '= ''geral'', nunca associação a um grupo — mesma razão que recusou a '
  'clínica sentinela (migration 0002).';

-- ---------------------------------------------------------------------------
-- `historico_grupo_da_clinica` — append-only, mesmo padrão de
-- `auditoria_do_painel` (REVOKE + trigger, nas duas camadas).
--
-- Sem FK para `clinicas` ainda: `clinica_id` nasce como `uuid` solto, e G1b
-- acrescenta a FK quando `clinicas.grupo_id` existir. Uma FK para uma coluna
-- que ainda não existe em `clinicas` seria prematura; o valor já é
-- referenciável pelo id real desde já, só não é cobrado pelo banco até lá.
-- ---------------------------------------------------------------------------
CREATE TABLE historico_grupo_da_clinica (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clinica_id      uuid NOT NULL REFERENCES clinicas(id),
  grupo_anterior_id uuid REFERENCES grupos(id),
  grupo_novo_id   uuid NOT NULL REFERENCES grupos(id),
  mudado_em       timestamptz NOT NULL DEFAULT now(),
  mudado_por      uuid NOT NULL REFERENCES operadores(id),
  motivo          text
);
CREATE INDEX historico_grupo_da_clinica_por_clinica
  ON historico_grupo_da_clinica (clinica_id, mudado_em DESC);

COMMENT ON TABLE historico_grupo_da_clinica IS
  'Quem tinha visão de qual clínica, entre quais datas — a pergunta de '
  'auditoria de LGPD que CONTEXT.md já antecipa. Append-only: mudar de grupo '
  'de novo é uma linha nova, nunca UPDATE na antiga.';

CREATE TRIGGER historico_grupo_da_clinica_sem_update
  BEFORE UPDATE OR DELETE OR TRUNCATE ON historico_grupo_da_clinica
  FOR EACH STATEMENT EXECUTE FUNCTION auditoria_e_append_only();

-- RLS, como qualquer tabela de negócio com `clinica_id` (regra 19) — mesmo
-- sendo `fir_app` já sem nenhum privilégio aqui (abaixo). `fir_carteira`
-- fixa `app.clinica_id` da clínica cujo grupo está mudando antes de
-- escrever, exatamente como qualquer papel escreve em qualquer clínica —
-- defesa em profundidade, não teatro: REVOKE e RLS nunca são o único
-- controle um do outro (teste/escrita-sem-rls.test.ts e
-- teste/isolamento-de-clinica.test.ts cobram as duas coisas, sempre juntas).
ALTER TABLE historico_grupo_da_clinica ENABLE ROW LEVEL SECURITY;
ALTER TABLE historico_grupo_da_clinica FORCE  ROW LEVEL SECURITY;
CREATE POLICY historico_grupo_da_clinica_por_clinica ON historico_grupo_da_clinica
  USING (clinica_id = app_clinica_id())
  WITH CHECK (clinica_id = app_clinica_id());

-- A trilha universal (regra 20), como em `movimentos_de_estoque`: a tabela é
-- SUA PRÓPRIA trilha de mudança de grupo, e AINDA ASSIM entra na varredura de
-- `registrar_auditoria` — é o padrão deste repositório (nenhuma tabela de
-- negócio escapa, `auditoria-inescapavel.test.ts`), não uma dispensa.
CREATE TRIGGER historico_grupo_da_clinica_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON historico_grupo_da_clinica
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

-- ---------------------------------------------------------------------------
-- `usuarios_gestao` — o ator. Nem `Pessoa`, nem `Operador`. Mesma forma
-- canônica de `pessoas.usuario`/`operadores.usuario` (ditável por telefone).
-- ---------------------------------------------------------------------------
CREATE TABLE usuarios_gestao (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario     text NOT NULL UNIQUE,
  nome        text NOT NULL,
  senha_hash  text NOT NULL,
  -- 'geral' (superadmin — na prática só o próprio Operador usa a carteira
  -- com este escopo) ou 'grupo'. CHECK abaixo garante que 'grupo' sempre tem
  -- grupo_id, e 'geral' nunca tem — nunca os dois, nunca nenhum dos dois.
  escopo      text NOT NULL CHECK (escopo IN ('geral', 'grupo')),
  grupo_id    uuid REFERENCES grupos(id),
  -- Estado, nunca exclusão — mesma regra 20 de `pessoas.ativo`/`operadores.ativo`.
  -- É também o mecanismo de revogação que a pendência P-12 exige: desativar
  -- aqui bloqueia a PRÓXIMA requisição, checado pelo guard a cada chamada,
  -- nunca por expiração de sessão.
  ativo       boolean NOT NULL DEFAULT true,
  senha_provisoria boolean NOT NULL DEFAULT false,
  senha_provisoria_expira_em timestamptz,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usuarios_gestao_usuario_canonico CHECK (
    usuario = normalizar_nome(usuario)
    AND usuario ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
    AND length(usuario) BETWEEN 3 AND 32
  ),
  CONSTRAINT usuarios_gestao_escopo_grupo CHECK (
    (escopo = 'grupo') = (grupo_id IS NOT NULL)
  ),
  CONSTRAINT provisoria_tem_prazo
    CHECK (NOT senha_provisoria OR senha_provisoria_expira_em IS NOT NULL)
);

COMMENT ON TABLE usuarios_gestao IS
  'O ator da carteira comercial. Só o Operador cria e atribui (ADR 0011) — '
  'nunca um fluxo de convite interno. Vê o grupo para o qual foi criado, '
  'nunca escolhe nem muda de grupo sozinho.';

COMMENT ON COLUMN usuarios_gestao.ativo IS
  'Desativar aqui é a revogação que a pendência P-12 exige: o guard checa '
  'isto a CADA requisição, nunca só no login — uma sessão viva de alguém '
  'desativado é acesso que devia ter acabado.';

-- ---------------------------------------------------------------------------
-- O TERCEIRO ATOR NA TRILHA. `auditoria.ator_tipo` ganha 'usuario_gestao',
-- ao lado de 'pessoa', 'operador' e 'sistema' — mesmo movimento da 0013 para
-- 'operador'.
-- ---------------------------------------------------------------------------
ALTER TABLE auditoria DROP CONSTRAINT auditoria_ator_tipo_check;
ALTER TABLE auditoria ADD CONSTRAINT auditoria_ator_tipo_check
  CHECK (ator_tipo IN ('pessoa', 'operador', 'usuario_gestao', 'sistema'));

-- `registrar_auditoria()`: corpo inteiro copiado da 0013 (que já havia
-- copiado da 0004), com o ramo novo. `CREATE OR REPLACE` exige o corpo
-- inteiro — editar uma migration já aplicada reescreveria o passado.
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
    -- O job/leitura da carteira, operando DENTRO de uma clínica (ADR 0012
    -- item 3): escreve na `auditoria` DAQUELA clínica, nunca numa trilha à
    -- parte — é o mesmo mecanismo do `operador:`, e é o que faz "a clínica
    -- pode ver quem olhou o agregado dela" (ADR 0013 §7) valer de verdade.
    v_tipo := 'usuario_gestao';
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
  'escrita quando ninguém declarou ator. Quatro atores: pessoa (uuid cru), '
  'sistema, operador do painel (operador:<uuid>) e usuário de gestão da '
  'carteira (usuario_gestao:<uuid>) — os dois últimos gravam na trilha DA '
  'CLÍNICA em que operam, que é a que ela enxerga.';

-- ---------------------------------------------------------------------------
-- PRIVILÉGIOS. `fir_app` não toca em nada da carteira — nem SELECT. Cada
-- GRANT a `fir_carteira` é uma linha, nunca `ALTER DEFAULT PRIVILEGES`
-- (mesma razão da 0013: concessão por omissão é acesso que ninguém decidiu).
-- ---------------------------------------------------------------------------
REVOKE ALL ON grupos, historico_grupo_da_clinica, usuarios_gestao FROM fir_app;

GRANT SELECT, INSERT, UPDATE ON grupos TO fir_carteira;
GRANT SELECT, INSERT ON historico_grupo_da_clinica TO fir_carteira;
REVOKE UPDATE, DELETE, TRUNCATE ON historico_grupo_da_clinica FROM fir_carteira;
GRANT SELECT, INSERT, UPDATE ON usuarios_gestao TO fir_carteira;

-- A carteira opera DENTRO de clínicas para ler telemetria/campanha (G2/G4) —
-- mas G1a não cria essas tabelas ainda. O GRANT em `auditoria` e `clinicas`
-- (leitura, para resolver nome de clínica por id) chega com G2, junto da
-- primeira tabela de negócio que a carteira de fato lê.

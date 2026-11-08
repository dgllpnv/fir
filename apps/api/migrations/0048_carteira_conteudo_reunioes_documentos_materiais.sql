-- ===========================================================================
-- G8, TICKET 1B — reuniões, documentos e materiais ESCRITOS PELA EQUIPE.
--
-- Inventário `docs/specs/g8-paridade-gestao-inventario.md` (V13, V14, X2 na
-- parte do cliente). Gates: `g8-gate-lgpd.md` A6–A14, `g8-gate-appsec.md`
-- A-7, A-8, A-9, A-18, A-19, A-20.
--
-- Forward-only, expand: só acrescenta coluna, índice, tabela, trigger e
-- policy mais estreita. Nenhuma migration aplicada é editada. As colunas
-- `compartilhada`/`arquivada_em` da ata já existem (0042).
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- PARTE 1 — `reunioes_comerciais`: os campos do formulário do protótipo
-- (`abrirReuniao`, `index.html` L1654–1681) que a 0034 não modelou.
--
-- NENHUMA destas colunas ganha GRANT para `fir_portal`: desde a 0042 o portal
-- tem SELECT por COLUNA, na lista branca (LGPD A7), e coluna nova não herda
-- privilégio. Participantes, saúde registrada, notas internas, quem registrou
-- e o id do Asana nunca chegam ao portal — por privilégio, antes de qualquer
-- código (`teste/portal-no-banco.test.ts` confere a lista exata).
-- ---------------------------------------------------------------------------

ALTER TABLE reunioes_comerciais
  -- `TIPO_REU` do protótipo (L1650). 'importada' só nasce pela importação do
  -- Asana (4B); o formulário não a oferece (L1664). As linhas antigas viram
  -- 'extra' (avulsa), o padrão do formulário.
  ADD COLUMN tipo text NOT NULL DEFAULT 'extra'
    CHECK (tipo IN ('semanal', 'mensal', 'diagnostico', 'extra', 'importada')),
  ADD COLUMN participantes text
    CHECK (participantes IS NULL OR length(participantes) <= 500),
  -- "Saúde da cliente depois da reunião" (L1669). Entra na saúde DERIVADA do
  -- cliente (PP-3, `saudeDerivadaDoCliente` em `packages/domain`) — nunca vira
  -- campo editável em `clientes_carteira`.
  ADD COLUMN saude_registrada text
    CHECK (saude_registrada IS NULL OR saude_registrada IN ('bom', 'atencao', 'critico')),
  -- Recomendação do gate LGPD (§3, "Impressões internas"): o que a equipe
  -- precisa anotar e a cliente não deve ler mora AQUI, num campo que o
  -- portal não tem privilégio de ler — e não no resumo, que vai inteiro
  -- quando a ata é compartilhada. Divergência do protótipo (que não tem o
  -- campo), registrada no relatório do ticket para o `product-rotina-clinica`.
  ADD COLUMN notas_internas text
    CHECK (notas_internas IS NULL OR length(notas_internas) <= 4000),
  -- A importação do Asana (4B) é idempotente por este id dentro do cliente.
  ADD COLUMN asana_id text
    CHECK (asana_id IS NULL OR length(asana_id) BETWEEN 1 AND 64),
  -- O instante do último "compartilhar". É a borda que o sinal de incidente
  -- (LGPD A10) usa: houve leitura do portal DEPOIS deste instante?
  ADD COLUMN compartilhada_em timestamptz,
  -- A-20: o duplo clique e o retry de rede em "Registrar reunião" não criam
  -- duas atas nem tarefas em dobro. Gerada pelo formulário ao abrir; o
  -- segundo envio com a mesma chave devolve a ata já criada.
  ADD COLUMN chave_idempotencia uuid,
  ADD COLUMN atualizado_em timestamptz;

-- O instante do compartilhamento é do BANCO, nunca do chamador: toda
-- passagem para `compartilhada = true` (registrar já compartilhada,
-- compartilhar, "Compartilhar todas", a importação do Asana, um INSERT de
-- teste) carimba `compartilhada_em = now()`. Assim a borda do sinal A10 não
-- depende de cada caminho de escrita lembrar de preenchê-la.
CREATE FUNCTION reunioes_comerciais_instante_do_compartilhamento() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.compartilhada AND (TG_OP = 'INSERT' OR NOT OLD.compartilhada) THEN
    NEW.compartilhada_em := now();
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER reunioes_comerciais_instante_do_compartilhamento
  BEFORE INSERT OR UPDATE OF compartilhada ON reunioes_comerciais
  FOR EACH ROW EXECUTE FUNCTION reunioes_comerciais_instante_do_compartilhamento();

-- Linhas antigas compartilhadas não existem (a 0042 nasceu com DEFAULT
-- false); com o trigger acima, o CHECK é a rede de segurança.
ALTER TABLE reunioes_comerciais
  ADD CONSTRAINT reunioes_comerciais_compartilhada_tem_instante
    CHECK (NOT compartilhada OR compartilhada_em IS NOT NULL);

CREATE UNIQUE INDEX reunioes_comerciais_idempotencia
  ON reunioes_comerciais (grupo_id, chave_idempotencia)
  WHERE chave_idempotencia IS NOT NULL;

CREATE UNIQUE INDEX reunioes_comerciais_asana
  ON reunioes_comerciais (cliente_carteira_id, asana_id)
  WHERE asana_id IS NOT NULL;

COMMENT ON COLUMN reunioes_comerciais.notas_internas IS
  'Notas internas da ata (gate LGPD §3): NUNCA vão ao portal — fir_portal não '
  'tem SELECT nesta coluna. O resumo é o que a cliente lê quando a ata é '
  'compartilhada.';
COMMENT ON COLUMN reunioes_comerciais.compartilhada_em IS
  'Último instante em que a ata foi compartilhada. Borda do sinal de incidente '
  '(LGPD A10): descompartilhar com leitura do portal depois daqui exige motivo '
  'e grava compartilhamentos_revertidos.';


-- ---------------------------------------------------------------------------
-- PARTE 2 — `documentos_carteira` e `materiais_carteira`: excluir vira
-- ARQUIVAR (regra 20, PP-5), e o material ganha o que o cadastro do protótipo
-- pede (`fMaterial`, L2713–2715): programas e texto.
--
-- Categoria e "só https" NÃO viram CHECK aqui: há linhas de teste antigas com
-- categoria livre, e a fonte da verdade da escrita é o contrato Zod
-- (`conteudo-carteira.ts`), a única porta de escrita. O banco guarda o que a
-- porta deixou entrar.
-- ---------------------------------------------------------------------------

ALTER TABLE documentos_carteira
  ADD COLUMN arquivado_em  timestamptz,
  ADD COLUMN atualizado_em timestamptz;

ALTER TABLE materiais_carteira
  ADD COLUMN programas     text[] NOT NULL DEFAULT '{}'
    CHECK (programas <@ ARRAY['Comercial', 'Financeiro', 'Operações', 'Gestão', 'Todos']::text[]),
  ADD COLUMN texto         text CHECK (texto IS NULL OR length(texto) <= 8000),
  ADD COLUMN arquivado_em  timestamptz,
  ADD COLUMN atualizado_em timestamptz;

-- O portal deixa de ver o arquivado — por AND, dentro do texto da policy
-- (A-7). `TO fir_portal` repetido de propósito (lição da 0035).
ALTER POLICY documentos_carteira_portal ON documentos_carteira
  TO fir_portal
  USING (visivel_portal AND arquivado_em IS NULL AND app_portal_pode_ver(grupo_id, cliente_carteira_id));

ALTER POLICY materiais_carteira_portal ON materiais_carteira
  TO fir_portal
  USING (visivel_portal AND arquivado_em IS NULL AND app_portal_pode_ver(grupo_id, cliente_carteira_id));

-- As policies da carteira nas três tabelas nasceram sem `TO` (0034) — valem
-- para PUBLIC. Hoje não vazam (a de `fir_portal` é a única outra, e o
-- portal não tem `app.escopo`), mas A-7 pede `TO` explícito em toda policy
-- alterada desta frente, e estas três passam a ter escrita real agora.
ALTER POLICY documentos_carteira_carteira ON documentos_carteira TO fir_carteira;
ALTER POLICY materiais_carteira_carteira  ON materiais_carteira  TO fir_carteira;
ALTER POLICY reunioes_comerciais_carteira ON reunioes_comerciais TO fir_carteira;

-- O anexo de documento arquivado também sai do portal. Mesma função da 0044,
-- com a condição a mais; a de reunião não muda.
CREATE OR REPLACE FUNCTION app_portal_pode_ver_dono_de_anexo(p_tipo text, p_dono uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
    SELECT coalesce(
      CASE p_tipo
        WHEN 'reuniao' THEN EXISTS (
          SELECT 1 FROM reunioes_comerciais r
           WHERE r.id = p_dono AND r.compartilhada AND r.arquivada_em IS NULL)
        WHEN 'documento' THEN EXISTS (
          SELECT 1 FROM documentos_carteira d
           WHERE d.id = p_dono AND d.visivel_portal AND d.arquivado_em IS NULL)
        ELSE false
      END,
      false)
  $$;

-- Trilha de escrita (regra 20) nas duas tabelas que ainda não tinham — a de
-- reunião nasceu na 0042. Sem `clinica_id`: vai para `auditoria_do_painel`.
CREATE TRIGGER documentos_carteira_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON documentos_carteira
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria_do_painel();

CREATE TRIGGER materiais_carteira_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON materiais_carteira
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria_do_painel();


-- ---------------------------------------------------------------------------
-- PARTE 3 — A-8: o `grupo_id` do filho não diverge do pai, nas três tabelas
-- antigas (dívida registrada pelo gate para a Onda 1). FK composta para
-- `clientes_carteira (id, grupo_id)` — o índice único do par nasceu na 0044.
-- `NOT VALID` + `VALIDATE` separados: a validação lê a tabela sem travar a
-- escrita; se uma linha antiga divergir, a migration falha aqui, e é o sinal
-- certo (um filho no grupo errado é exatamente o vazamento que a RLS não vê).
-- ---------------------------------------------------------------------------
ALTER TABLE reunioes_comerciais
  ADD CONSTRAINT reunioes_comerciais_cliente_do_grupo
    FOREIGN KEY (cliente_carteira_id, grupo_id) REFERENCES clientes_carteira (id, grupo_id)
    ON UPDATE CASCADE NOT VALID;
ALTER TABLE reunioes_comerciais VALIDATE CONSTRAINT reunioes_comerciais_cliente_do_grupo;

ALTER TABLE documentos_carteira
  ADD CONSTRAINT documentos_carteira_cliente_do_grupo
    FOREIGN KEY (cliente_carteira_id, grupo_id) REFERENCES clientes_carteira (id, grupo_id)
    ON UPDATE CASCADE NOT VALID;
ALTER TABLE documentos_carteira VALIDATE CONSTRAINT documentos_carteira_cliente_do_grupo;

ALTER TABLE materiais_carteira
  ADD CONSTRAINT materiais_carteira_cliente_do_grupo
    FOREIGN KEY (cliente_carteira_id, grupo_id) REFERENCES clientes_carteira (id, grupo_id)
    ON UPDATE CASCADE NOT VALID;
ALTER TABLE materiais_carteira VALIDATE CONSTRAINT materiais_carteira_cliente_do_grupo;

-- O mesmo par na ata, para os filhos dela apontarem com FK composta.
CREATE UNIQUE INDEX reunioes_comerciais_id_grupo_unico ON reunioes_comerciais (id, grupo_id);


-- ---------------------------------------------------------------------------
-- PARTE 4 — `encaminhamentos_de_reuniao`: cada linha de "Encaminhamentos" da
-- ata registrada, e a `Tarefa interna` que ela gerou ("Criar uma tarefa para
-- cada linha", L1667; `salvarReuniao`, L1705–1707).
--
-- IDEMPOTÊNCIA (A-20): `UNIQUE (reuniao_comercial_id, ordem)` — a mesma linha
-- da mesma ata nunca gera duas tarefas; `UNIQUE (tarefa_interna_id)` — uma
-- tarefa nunca é de dois encaminhamentos. O serviço insere com
-- `ON CONFLICT DO NOTHING` e relê.
--
-- O texto da ata continua em `reunioes_comerciais.encaminhamentos` (é o que o
-- portal lê, "Próximos passos"). Esta tabela é o despacho feito no registro;
-- editar a ata depois não recria tarefa (o protótipo também só cria no
-- registro, L1667 `${r?"":...}`).
-- ---------------------------------------------------------------------------
CREATE TABLE encaminhamentos_de_reuniao (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reuniao_comercial_id uuid NOT NULL,
  grupo_id             uuid NOT NULL REFERENCES grupos(id),
  ordem                int  NOT NULL CHECK (ordem BETWEEN 1 AND 50),
  texto                text NOT NULL CHECK (length(btrim(texto)) BETWEEN 1 AND 300),
  tarefa_interna_id    uuid UNIQUE REFERENCES tarefas_internas(id),
  criado_em            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT encaminhamentos_de_reuniao_da_ata
    FOREIGN KEY (reuniao_comercial_id, grupo_id)
    REFERENCES reunioes_comerciais (id, grupo_id)
    ON UPDATE CASCADE,
  CONSTRAINT encaminhamentos_de_reuniao_uma_vez UNIQUE (reuniao_comercial_id, ordem)
);

COMMENT ON TABLE encaminhamentos_de_reuniao IS
  'Encaminhamento de reunião (G8 1B): uma linha dos encaminhamentos de uma ata, '
  'e a Tarefa interna que ela gerou no registro. UNIQUE (ata, ordem) e UNIQUE '
  '(tarefa): o registro repetido nunca cria tarefa em dobro (appsec A-20).';

CREATE INDEX encaminhamentos_de_reuniao_por_grupo ON encaminhamentos_de_reuniao (grupo_id);

ALTER TABLE encaminhamentos_de_reuniao ENABLE ROW LEVEL SECURITY;
ALTER TABLE encaminhamentos_de_reuniao FORCE  ROW LEVEL SECURITY;

CREATE POLICY encaminhamentos_de_reuniao_por_grupo ON encaminhamentos_de_reuniao
  TO fir_carteira
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

REVOKE ALL ON encaminhamentos_de_reuniao FROM fir_app;
GRANT SELECT, INSERT, UPDATE ON encaminhamentos_de_reuniao TO fir_carteira;

CREATE TRIGGER encaminhamentos_de_reuniao_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON encaminhamentos_de_reuniao
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria_do_painel();


-- ---------------------------------------------------------------------------
-- PARTE 5 — `compartilhamentos_revertidos`: o sinal de incidente detectável
-- (LGPD A10).
--
-- Quando uma ata é DEScompartilhada e o portal daquele cliente foi lido
-- DEPOIS do último compartilhamento, a cliente pode ter lido o que não devia.
-- O serviço exige o motivo e grava esta linha — que põe o caso na mesa de
-- quem avalia se é incidente comunicável (art. 48), em vez de sumir num
-- clique. Append-only: só SELECT e INSERT para `fir_carteira`.
-- Retenção: 5 anos (`retencao.md`, linha do A10).
-- ---------------------------------------------------------------------------
CREATE TABLE compartilhamentos_revertidos (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reuniao_comercial_id     uuid NOT NULL,
  cliente_carteira_id      uuid NOT NULL,
  grupo_id                 uuid NOT NULL REFERENCES grupos(id),
  compartilhada_em         timestamptz NOT NULL,
  ultima_leitura_portal_em timestamptz NOT NULL,
  motivo                   text NOT NULL CHECK (length(btrim(motivo)) BETWEEN 3 AND 1000),
  por_usuario_gestao_id    uuid NOT NULL REFERENCES usuarios_gestao(id),
  criado_em                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT compartilhamentos_revertidos_da_ata
    FOREIGN KEY (reuniao_comercial_id, grupo_id)
    REFERENCES reunioes_comerciais (id, grupo_id)
    ON UPDATE CASCADE,
  CONSTRAINT compartilhamentos_revertidos_cliente_do_grupo
    FOREIGN KEY (cliente_carteira_id, grupo_id)
    REFERENCES clientes_carteira (id, grupo_id)
    ON UPDATE CASCADE,
  CONSTRAINT compartilhamentos_revertidos_leitura_depois
    CHECK (ultima_leitura_portal_em >= compartilhada_em)
);

COMMENT ON TABLE compartilhamentos_revertidos IS
  'Compartilhamento revertido após leitura (LGPD A10): a ata foi '
  'descompartilhada depois de o portal do cliente ter sido lido. Sinal para '
  'avaliar incidente (art. 48). Append-only. Retenção 5 anos.';

CREATE INDEX compartilhamentos_revertidos_por_grupo ON compartilhamentos_revertidos (grupo_id, criado_em DESC);

ALTER TABLE compartilhamentos_revertidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE compartilhamentos_revertidos FORCE  ROW LEVEL SECURITY;

CREATE POLICY compartilhamentos_revertidos_por_grupo ON compartilhamentos_revertidos
  TO fir_carteira
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

REVOKE ALL ON compartilhamentos_revertidos FROM fir_app;
GRANT SELECT, INSERT ON compartilhamentos_revertidos TO fir_carteira;

CREATE TRIGGER compartilhamentos_revertidos_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON compartilhamentos_revertidos
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria_do_painel();


-- ---------------------------------------------------------------------------
-- PARTE 6 — `materiais_da_biblioteca`: a biblioteca GERAL do Método Firmare
-- (X2, `vMetodo` L2687–2692), em TABELA PRÓPRIA (appsec A-18: nunca tornar
-- nulo o `grupo_id` de `materiais_carteira`). Conteúdo da Firmare, sem
-- tenant — por isso RLS própria (A-19):
--   * leitura pela carteira: liberada (A-18), para a ficha de qualquer
--     cliente listar "Materiais do programa";
--   * escrita: só `escopo = 'geral'`. O gate pede também
--     `carteira.administrar`, chave que AINDA NÃO EXISTE (ticket 0.5): quando
--     existir, a policy de escrita ganha a condição por AND e o serviço
--     confere com `temPermCarteira`. Ponto marcado no serviço;
--   * portal: SEM GRANT nesta fatia. A leitura pelo portal (filtro por
--     programa, `NOT uso_interno` por AND, função com CASE) é do ticket 3D.
-- ---------------------------------------------------------------------------
CREATE TABLE materiais_da_biblioteca (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo        text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 160),
  tipo          text NOT NULL
    CHECK (tipo IN ('Planilha', 'Documento', 'Script', 'Modelo de mensagem', 'Apresentação')),
  -- "Quem pode receber": "Só uso interno" (L2713).
  uso_interno   boolean NOT NULL,
  programas     text[] NOT NULL DEFAULT '{}'
    CHECK (programas <@ ARRAY['Comercial', 'Financeiro', 'Operações', 'Gestão', 'Todos']::text[]),
  link          text CHECK (link IS NULL OR length(btrim(link)) BETWEEN 1 AND 2000),
  texto         text CHECK (texto IS NULL OR length(texto) <= 8000),
  descricao     text CHECK (descricao IS NULL OR length(descricao) <= 500),
  criado_por    uuid NOT NULL REFERENCES usuarios_gestao(id),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz,
  arquivado_em  timestamptz
);

COMMENT ON TABLE materiais_da_biblioteca IS
  'Material da biblioteca (G8 X2): conteúdo geral do Método Firmare, sem '
  'cliente e sem grupo (tabela própria, appsec A-18). O personalizado de um '
  'cliente continua em materiais_carteira, com grupo_id NOT NULL.';

ALTER TABLE materiais_da_biblioteca ENABLE ROW LEVEL SECURITY;
ALTER TABLE materiais_da_biblioteca FORCE  ROW LEVEL SECURITY;

CREATE POLICY materiais_da_biblioteca_leitura ON materiais_da_biblioteca
  FOR SELECT TO fir_carteira
  USING (true);

CREATE POLICY materiais_da_biblioteca_criacao ON materiais_da_biblioteca
  FOR INSERT TO fir_carteira
  WITH CHECK (app_escopo() = 'geral');

CREATE POLICY materiais_da_biblioteca_edicao ON materiais_da_biblioteca
  FOR UPDATE TO fir_carteira
  USING (app_escopo() = 'geral')
  WITH CHECK (app_escopo() = 'geral');

REVOKE ALL ON materiais_da_biblioteca FROM fir_app;
GRANT SELECT, INSERT, UPDATE ON materiais_da_biblioteca TO fir_carteira;

CREATE TRIGGER materiais_da_biblioteca_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON materiais_da_biblioteca
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria_do_painel();


-- ---------------------------------------------------------------------------
-- PARTE 7 — `envios_de_material`: "Enviar para a cliente" e o "Enviado em"
-- do cartão (`cardMaterial` L2703–2705; `data-wamat` L2810). Um FATO, sem o
-- texto da mensagem (retenção: "Fato de envio... sem o texto"). Append-only.
--
-- O material é ou da biblioteca ou personalizado — exatamente um dos dois,
-- pelo CHECK. O personalizado precisa ser do MESMO cliente e grupo (FK
-- composta abaixo não alcança isso porque o material tem o próprio cliente;
-- o serviço confere sob RLS antes do INSERT).
--
-- Abrir o WhatsApp não prova o envio (PP-6): a linha nasce de uma
-- confirmação explícita, nunca do clique que abre a conversa.
-- ---------------------------------------------------------------------------
CREATE TABLE envios_de_material (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_carteira_id    uuid NOT NULL,
  grupo_id               uuid NOT NULL REFERENCES grupos(id),
  material_biblioteca_id uuid REFERENCES materiais_da_biblioteca(id),
  material_carteira_id   uuid REFERENCES materiais_carteira(id),
  enviado_em             timestamptz NOT NULL DEFAULT now(),
  por_usuario_gestao_id  uuid NOT NULL REFERENCES usuarios_gestao(id),

  CONSTRAINT envios_de_material_cliente_do_grupo
    FOREIGN KEY (cliente_carteira_id, grupo_id)
    REFERENCES clientes_carteira (id, grupo_id)
    ON UPDATE CASCADE,
  CONSTRAINT envios_de_material_um_material
    CHECK (num_nonnulls(material_biblioteca_id, material_carteira_id) = 1)
);

COMMENT ON TABLE envios_de_material IS
  'Envio de material (G8 X2): o fato de a equipe ter enviado um material a um '
  'Cliente Firmare. Sem o texto da mensagem. Append-only.';

CREATE INDEX envios_de_material_por_cliente ON envios_de_material (cliente_carteira_id, enviado_em DESC);

ALTER TABLE envios_de_material ENABLE ROW LEVEL SECURITY;
ALTER TABLE envios_de_material FORCE  ROW LEVEL SECURITY;

CREATE POLICY envios_de_material_por_grupo ON envios_de_material
  TO fir_carteira
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

REVOKE ALL ON envios_de_material FROM fir_app;
GRANT SELECT, INSERT ON envios_de_material TO fir_carteira;

CREATE TRIGGER envios_de_material_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON envios_de_material
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria_do_painel();

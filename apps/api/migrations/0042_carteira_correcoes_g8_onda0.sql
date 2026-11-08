-- ===========================================================================
-- G8, ONDA 0 — dois defeitos da carteira que JÁ ESTÃO EM PRODUÇÃO.
-- Inventário `docs/specs/g8-paridade-gestao-inventario.md`, tickets 0.1 e
-- 0.2; pareceres `g8-gate-appsec.md` (A-7, A-8, A-11, F-3) e
-- `g8-gate-lgpd.md` (A6, A7, A8).
--
-- Forward-only, expand: só acrescenta coluna, índice, função e policy mais
-- estreita. Nenhuma migration aplicada é editada.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- PARTE 1 — Reunião só aparece no portal se foi COMPARTILHADA (ticket 0.1,
-- D-P1, A-7, LGPD A6/A7).
--
-- No protótipo compartilhar é escolha explícita, e o checkbox nasce
-- desmarcado (`index.html` L1671; o texto do espaço da cliente em
-- `fg-supabase.js` L243 diz isso). A 0034 criou `reunioes_comerciais` sem a
-- flag e com a policy do portal mostrando TODAS — divergência sem ADR, e com
-- risco: a ata leva impressões internas.
--
-- BACKFILL: as linhas existentes ficam `false` (o DEFAULT faz isso). Quantas
-- há em produção não é medível daqui; hoje não existe rota de escrita em
-- `reunioes_comerciais` (inventário V14), então o esperado é zero ou poucas
-- linhas inseridas à mão. Se houver, elas SOMEM do portal neste deploy — e é
-- o comportamento certo (A-7, último item), não regressão. Quem quiser
-- devolver uma ata ao portal compartilha de propósito, ata por ata.
-- ---------------------------------------------------------------------------

ALTER TABLE reunioes_comerciais
  ADD COLUMN compartilhada boolean NOT NULL DEFAULT false,
  -- "Excluir" vira arquivar (regra 20). Nasce aqui porque a policy do portal
  -- já precisa recusar a ata arquivada (A-7), antes da rota que arquiva.
  ADD COLUMN arquivada_em  timestamptz;

COMMENT ON COLUMN reunioes_comerciais.compartilhada IS
  'Compartilhada com a cliente (protótipo L1671, nasce desmarcado). Só a '
  'ata compartilhada e não arquivada chega ao portal — por AND na policy '
  'reunioes_comerciais_portal, nunca por OR.';
COMMENT ON COLUMN reunioes_comerciais.arquivada_em IS
  'Arquivar no lugar de excluir (regra 20). Ata arquivada nunca chega ao portal.';

COMMENT ON TABLE reunioes_comerciais IS
  'Reunião comercial (CONTEXT.md): ata de uma reunião da Firmare com um '
  'Cliente Firmare. Só chega ao portal quando compartilhada AND não '
  'arquivada (0042, corrige o comentário da 0034, que dizia "toda reunião '
  'é visível ao portal"). O portal lê só as colunas da lista branca (LGPD '
  'A7), por privilégio de coluna.';

-- A policy do portal ganha as duas condições por AND, dentro do texto da
-- policy. `TO fir_portal` repetido de propósito: a lição da 0035 é que
-- policy sem `TO` vale para PUBLIC e se soma por OR à do portal.
ALTER POLICY reunioes_comerciais_portal ON reunioes_comerciais
  TO fir_portal
  USING (compartilhada AND arquivada_em IS NULL AND app_portal_pode_ver(grupo_id, cliente_carteira_id));

-- Privilégio por coluna (A-7, LGPD A7): `fir_portal` deixa de ter SELECT na
-- tabela inteira e passa a ter só nas colunas da lista branca, mais as que a
-- própria leitura usa para ligar a ata ao cliente. `por_usuario_gestao_id`
-- (quem registrou), `criado_em`, e as colunas internas que a Onda 1 vai
-- acrescentar (participantes, saúde registrada, asana_id) ficam de fora —
-- uma coluna nova NÃO herda SELECT do portal, porque não há mais GRANT de
-- tabela. É o que torna a lista branca a primeira camada, não só o SELECT
-- da aplicação.
--
-- `compartilhada` e `arquivada_em` entram para que a leitura do portal
-- repita o filtro no `WHERE` (segunda camada — a aplicação também filtra);
-- não são devolvidos na resposta.
REVOKE SELECT ON reunioes_comerciais FROM fir_portal;
GRANT SELECT (id, cliente_carteira_id, grupo_id, data, resumo, encaminhamentos, anexos,
              compartilhada, arquivada_em)
  ON reunioes_comerciais TO fir_portal;

-- LGPD A8: toda mudança de `compartilhada` é auditada (de → para, quem,
-- quando). Hoje não há rota de escrita; o trigger nasce antes dela, como os
-- de G5 (0032) — assim a primeira escrita já sai com trilha, sem depender de
-- quem escrever o serviço lembrar. Tabela sem `clinica_id`: vai para
-- `auditoria_do_painel`.
CREATE TRIGGER reunioes_comerciais_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON reunioes_comerciais
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria_do_painel();


-- ---------------------------------------------------------------------------
-- PARTE 2 — Conversão de lead (ticket 0.2, F-3, A-11).
--
-- O DEFEITO: um `Usuário de Gestão` de escopo 'geral' cria um lead sem grupo
-- (a maioria — `leads_comerciais.grupo_id` é nullable de propósito, 0032) e
-- o converte. `clientes_carteira.grupo_id` é NOT NULL e o INSERT cai em 500.
-- E a conversão lia o lead sem trava: dois cliques simultâneos criavam dois
-- clientes (reproduzido em `conversao-de-lead.e2e.test.ts`).
--
-- A CORREÇÃO (A-11):
--   * `clientes_carteira.lead_origem_id` UNIQUE — o segundo clique nunca
--     cria um segundo cliente, nem que a trava falhe;
--   * o serviço trava o lead com `SELECT … FOR UPDATE` (aplicação);
--   * lead sem grupo, convertido por escopo 'geral', ganha um grupo PRÓPRIO
--     do cliente, na MESMA transação, por `criar_grupo_de_conversao`. Nome e
--     existência do grupo saem do lead, dentro do banco — nunca do corpo.
-- ---------------------------------------------------------------------------

-- ON DELETE SET NULL: lead nunca é apagado em produção (arquivar, regra 20);
-- só a limpeza de teste apaga. Sem isto, toda limpeza que apaga o lead antes
-- do cliente (a ordem que os testes da 0032 já usam) quebraria.
ALTER TABLE clientes_carteira
  ADD COLUMN lead_origem_id uuid REFERENCES leads_comerciais(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX clientes_carteira_lead_origem_unico
  ON clientes_carteira (lead_origem_id) WHERE lead_origem_id IS NOT NULL;

COMMENT ON COLUMN clientes_carteira.lead_origem_id IS
  'O lead comercial que virou este cliente (conversão, G5). UNIQUE: um lead '
  'converte em no máximo um cliente — o duplo clique devolve o mesmo (F-3).';

-- Backfill das conversões já feitas: o lead aponta para o cliente desde a
-- 0032 (`leads_comerciais.cliente_carteira_id`). O trigger de auditoria de
-- `clientes_carteira` exige ator declarado — é a migration, então 'sistema'.
SELECT set_config('app.pessoa_id', 'sistema', true);
UPDATE clientes_carteira c
   SET lead_origem_id = l.id
  FROM leads_comerciais l
 WHERE l.cliente_carteira_id = c.id
   AND c.lead_origem_id IS NULL;

-- O grupo nasce MARCADO: quem o criou foi a conversão de um lead, não o
-- Operador (A-11 item 2). Os grupos existentes são todos do Operador.
ALTER TABLE grupos
  ADD COLUMN origem text NOT NULL DEFAULT 'operador'
    CHECK (origem IN ('operador', 'conversao_de_lead')),
  ADD COLUMN lead_origem_id uuid UNIQUE REFERENCES leads_comerciais(id) ON DELETE SET NULL;

COMMENT ON COLUMN grupos.origem IS
  'operador: criado pelo Operador (ADR 0011 §2). conversao_de_lead: grupo '
  'próprio de um cliente que nasceu de lead sem grupo, criado por '
  'criar_grupo_de_conversao (G8 0.2, appsec A-11).';
COMMENT ON COLUMN grupos.lead_origem_id IS
  'O lead cuja conversão criou este grupo. UNIQUE: um lead gera no máximo um grupo.';

-- A ÚNICA porta de criação de grupo para quem não é o Operador.
--
-- Recebe só o id do lead: nome e existência do grupo saem da linha do lead,
-- aqui dentro. Confere escopo 'geral', ator `Usuário de Gestão`, lead
-- existente, sem grupo, não convertido e não arquivado — e trava a linha.
-- Grava a trilha em `auditoria_do_painel` com o ator REAL (o padrão de
-- `grupos` é trilha escrita à mão, 0030; não há trigger nessa tabela).
--
-- DONO: `fir_migrate`, como todas as funções SECURITY DEFINER do projeto.
-- O parecer A-11 item 2 pede um papel próprio sem BYPASSRLS; criar papel
-- exige CREATEROLE, que `fir_migrate` não tem (e não deve ter), e o
-- provisionamento de papéis mora em `infra/bootstrap-papeis.sql` e no
-- deploy — fora desta migration. Registrado como pendência no relatório do
-- ticket. Mitigação aqui: a função não lê nada além da linha do lead pelo
-- id, não aceita texto livre, e `search_path` fixo.
CREATE FUNCTION criar_grupo_de_conversao(p_lead_id uuid) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_cru   text := coalesce(current_setting('app.pessoa_id', true), '');
  v_tipo  text;
  v_ator  uuid;
  v_lead  record;
  v_grupo uuid;
BEGIN
  IF app_escopo() IS DISTINCT FROM 'geral' THEN
    RAISE EXCEPTION 'criar_grupo_de_conversao: só o escopo geral cria grupo de conversão'
      USING ERRCODE = '42501';
  END IF;

  IF v_cru = '' THEN
    RAISE EXCEPTION 'criar_grupo_de_conversao: ator não declarado' USING ERRCODE = '42501';
  END IF;
  SELECT tipo, ator INTO v_tipo, v_ator FROM auditoria_resolver_ator(v_cru);
  IF v_tipo IS DISTINCT FROM 'usuario_gestao' THEN
    RAISE EXCEPTION 'criar_grupo_de_conversao: só um Usuário de Gestão converte lead'
      USING ERRCODE = '42501';
  END IF;

  SELECT id, nome, grupo_id, etapa, cliente_carteira_id, arquivado_em
    INTO v_lead
    FROM leads_comerciais
   WHERE id = p_lead_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'criar_grupo_de_conversao: lead não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_lead.grupo_id IS NOT NULL THEN
    RAISE EXCEPTION 'criar_grupo_de_conversao: o lead já tem grupo' USING ERRCODE = '22023';
  END IF;
  IF v_lead.etapa = 'ganho' OR v_lead.cliente_carteira_id IS NOT NULL THEN
    RAISE EXCEPTION 'criar_grupo_de_conversao: o lead já foi convertido' USING ERRCODE = '22023';
  END IF;
  IF v_lead.arquivado_em IS NOT NULL THEN
    RAISE EXCEPTION 'criar_grupo_de_conversao: o lead está arquivado' USING ERRCODE = '22023';
  END IF;

  INSERT INTO grupos (nome, origem, lead_origem_id)
  VALUES (v_lead.nome, 'conversao_de_lead', v_lead.id)
  RETURNING id INTO v_grupo;

  INSERT INTO auditoria_do_painel (ator_tipo, ator_id, acao, entidade, entidade_id, de, para)
  VALUES (v_tipo, v_ator, 'criou', 'grupos', v_grupo::text, NULL,
          jsonb_build_object('nome', v_lead.nome, 'origem', 'conversao_de_lead',
                             'lead_origem_id', v_lead.id));

  RETURN v_grupo;
END $$;

COMMENT ON FUNCTION criar_grupo_de_conversao(uuid) IS
  'Grupo próprio do cliente que nasce de lead SEM grupo, convertido por '
  'escopo geral (G8 0.2, appsec A-11). Nome derivado do lead, nunca da '
  'requisição. Auditado com o Usuário de Gestão real.';

REVOKE ALL ON FUNCTION criar_grupo_de_conversao(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION criar_grupo_de_conversao(uuid) TO fir_carteira;

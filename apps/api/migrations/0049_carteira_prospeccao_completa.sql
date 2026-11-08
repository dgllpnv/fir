-- ===========================================================================
-- G8, TICKET 1E — prospecção completa, igual ao protótipo.
-- Inventário `docs/specs/g8-paridade-gestao-inventario.md` (L1–L8, L11, L12),
-- gates `g8-gate-numeros.md` (ajustes 9, 10, 14, 15), `g8-gate-lgpd.md`
-- (A37, A39, retenção do lead) e `g8-gate-appsec.md` (A-8, A-11 item 7, A-20).
-- Decisão do dono: D-22 item 11 (benefício de quem indicou sem ser cliente
-- fica guardado até a pessoa virar cliente).
--
-- Forward-only, EXPAND: só acrescenta coluna, índice, restrição, tabela e
-- função. A única relaxação é `beneficios_de_indicacao.cliente_carteira_id`
-- perder o NOT NULL — compatível com o código anterior, que só lê a linha
-- que ele mesmo criou (sempre com cliente) e consome por `cliente_carteira_id
-- = $1` (o benefício guardado, sem cliente, nunca é candidato).
-- ===========================================================================

-- O trigger de auditoria exige ator declarado; o backfill abaixo é a migration.
SELECT set_config('app.pessoa_id', 'sistema', true);


-- ---------------------------------------------------------------------------
-- PARTE 1 — Os campos do lead que o protótipo tem e o nosso não (L4, `fLead`
-- L2554-2558, `leadsExemplo` L523).
--
-- LGPD (retenção, linha nova de `retencao.md` no mesmo PR): WhatsApp,
-- Instagram, cidade, clínica e especialidade de médico prospectado são dado
-- pessoal sem contrato — legítimo interesse (art. 7º, IX), com oposição
-- (`nao_contatar`, A37) e prazo de 12 meses depois do último contato para
-- lead perdido ou arquivado.
-- ---------------------------------------------------------------------------

ALTER TABLE leads_comerciais
  ADD COLUMN especialidade  text,
  ADD COLUMN clinica        text,
  ADD COLUMN cidade         text,
  ADD COLUMN whatsapp       text,
  ADD COLUMN instagram      text,
  -- "Indicado por cliente da carteira" (L2555). FK simples: o lead pode não
  -- ter grupo (escopo geral), então não há par (id, grupo_id) a amarrar. O
  -- serviço valida que o cliente é visível pela sessão antes do INSERT (A-11
  -- item 7) — para escopo 'grupo', a RLS de `clientes_carteira` já garante o
  -- mesmo grupo.
  ADD COLUMN cliente_indicador_id uuid REFERENCES clientes_carteira(id),
  -- "Quem indicou, se não foi cliente (parceiro, amigo, evento)" (L2555).
  ADD COLUMN indicado_por   text,
  -- "Valor estimado por mês (R$)" (L2557). Centavos, BIGINT (regra 1). É o
  -- potencial do funil, NUNCA receita (regra 4; gate de números, ajuste 14).
  ADD COLUMN valor_estimado_centavos bigint
    CHECK (valor_estimado_centavos IS NULL OR valor_estimado_centavos >= 0),
  -- "Indicação recebida em" — data editável (L2557), distinta de `criado_em`
  -- (quando a linha nasceu). Dia civil no fuso da carteira.
  ADD COLUMN recebida_em    date,
  ADD COLUMN observacoes    text,
  -- Oposição ao contato (LGPD A37, art. 18 §2º). O servidor recusa contato
  -- novo, esconde o botão de WhatsApp e tira o lead dos contatos recomendados.
  ADD COLUMN nao_contatar    boolean NOT NULL DEFAULT false,
  ADD COLUMN nao_contatar_em timestamptz,
  -- Exclusão a pedido do titular (A37): a linha fica, ANONIMIZADA, para a
  -- contagem do funil; o telefone vai para a lista de supressão como hash.
  ADD COLUMN excluido_a_pedido_em timestamptz,

  ADD CONSTRAINT leads_nao_contatar_tem_data
    CHECK (NOT nao_contatar OR nao_contatar_em IS NOT NULL);

COMMENT ON COLUMN leads_comerciais.valor_estimado_centavos IS
  'Valor estimado por mês, em centavos (L2557). Potencial do funil, nunca '
  'receita, MRR nem meta (regra 4). Redigido sem a permissão valores.';
COMMENT ON COLUMN leads_comerciais.nao_contatar IS
  'Oposição ao contato (LGPD A37). Respeitada no servidor: contato novo é '
  'recusado e o lead sai dos contatos recomendados.';

-- Backfill: a data de recebimento das linhas antigas é o dia em que nasceram,
-- no fuso da carteira (`FUSO_DA_CARTEIRA`, apps/api/src/carteira/fuso-da-carteira.ts).
UPDATE leads_comerciais
   SET recebida_em = (criado_em AT TIME ZONE 'America/Bahia')::date
 WHERE recebida_em IS NULL;

-- Sem DEFAULT: o serviço sempre grava o hoje do SERVIDOR no fuso da carteira
-- (regra 24). Um DEFAULT aqui seria um segundo lugar com o fuso fixado.
ALTER TABLE leads_comerciais ALTER COLUMN recebida_em SET NOT NULL;

CREATE INDEX leads_comerciais_por_cliente_indicador ON leads_comerciais (cliente_indicador_id)
  WHERE cliente_indicador_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- PARTE 2 — "Registrar contato" (L5, L2559-2565): a data do contato e a
-- chave de idempotência.
--
-- O formulário tem "Data" (o contato pode ter sido ontem); `quando` continua
-- sendo o instante em que a linha foi gravada. A chave de idempotência
-- (A-20) faz a requisição repetida — duplo toque, retry de rede — devolver o
-- mesmo registro, nunca dois.
-- ---------------------------------------------------------------------------

ALTER TABLE interacoes_do_lead
  ADD COLUMN data_do_contato    date,
  ADD COLUMN chave_idempotencia uuid;

UPDATE interacoes_do_lead
   SET data_do_contato = (quando AT TIME ZONE 'America/Bahia')::date
 WHERE data_do_contato IS NULL;

ALTER TABLE interacoes_do_lead ALTER COLUMN data_do_contato SET NOT NULL;

CREATE UNIQUE INDEX interacoes_do_lead_idempotencia
  ON interacoes_do_lead (lead_comercial_id, chave_idempotencia)
  WHERE chave_idempotencia IS NOT NULL;

COMMENT ON COLUMN interacoes_do_lead.data_do_contato IS
  'O dia em que o contato aconteceu, informado no formulário (L2560), nunca '
  'depois do hoje do servidor. `quando` é o instante da gravação.';
COMMENT ON COLUMN interacoes_do_lead.chave_idempotencia IS
  'Gerada pela tela a cada formulário aberto. UNIQUE por lead: repetir a '
  'requisição não cria um segundo contato (A-20).';


-- ---------------------------------------------------------------------------
-- PARTE 3 — Benefício de indicação ligado ao lead (L6, L12; D-22 item 11).
--
-- Antes: só existia benefício com cliente, criado à mão (`POST
-- /v1/carteira/beneficios`). Agora a conversão de um lead INDICADO gera o
-- benefício na mesma transação:
--   * indicado por cliente da carteira → benefício do cliente, consumido pela
--     próxima cobrança (o job de geração já faz isso);
--   * indicado por quem NÃO é cliente → benefício GUARDADO (`cliente_carteira_id
--     NULL`, `indicador_nome`), sem cobrança onde ser aplicado, até alguém
--     ligá-lo ao cliente quando a pessoa virar cliente.
-- ---------------------------------------------------------------------------

ALTER TABLE beneficios_de_indicacao
  ALTER COLUMN cliente_carteira_id DROP NOT NULL,
  -- ON DELETE SET NULL: lead nunca é apagado em produção (arquivar, regra 20);
  -- só a limpeza de teste apaga — mesmo padrão de `clientes_carteira.
  -- lead_origem_id` (0042).
  ADD COLUMN lead_comercial_id uuid REFERENCES leads_comerciais(id) ON DELETE SET NULL,
  ADD COLUMN indicador_nome    text,
  ADD COLUMN vinculado_em      timestamptz,

  ADD CONSTRAINT beneficio_tem_beneficiario
    CHECK (cliente_carteira_id IS NOT NULL OR indicador_nome IS NOT NULL),
  -- Benefício guardado nunca é consumido: não há cobrança sem cliente.
  ADD CONSTRAINT beneficio_so_consome_com_cliente
    CHECK (consumido_em IS NULL OR cliente_carteira_id IS NOT NULL);

-- A-20: um lead gera no máximo um benefício. A conversão repetida (duplo
-- clique, retry) bate aqui e não cria o segundo.
CREATE UNIQUE INDEX beneficios_de_indicacao_um_por_lead
  ON beneficios_de_indicacao (lead_comercial_id) WHERE lead_comercial_id IS NOT NULL;

-- A-8: o `grupo_id` do benefício é o do cliente — a RLS decide por ele, e um
-- filho com grupo divergente do pai é exatamente o estado que não pode ser
-- representável. MATCH SIMPLE: o benefício guardado (cliente NULL) não é
-- conferido, e não há o que conferir. NOT VALID: vale para toda escrita
-- daqui em diante sem reprovar o deploy por uma linha antiga; a
-- conferência das antigas é o `VALIDATE` de um release seguinte (contract).
ALTER TABLE beneficios_de_indicacao
  ADD CONSTRAINT beneficios_de_indicacao_cliente_do_grupo
    FOREIGN KEY (cliente_carteira_id, grupo_id) REFERENCES clientes_carteira (id, grupo_id)
    NOT VALID;

COMMENT ON COLUMN beneficios_de_indicacao.cliente_carteira_id IS
  'Quem recebe o desconto. NULL = benefício GUARDADO: quem indicou ainda não '
  'é cliente (indicador_nome), e fica guardado até virar (D-22 item 11).';
COMMENT ON COLUMN beneficios_de_indicacao.lead_comercial_id IS
  'O lead cuja conversão gerou este benefício. UNIQUE: um por lead (A-20).';
COMMENT ON COLUMN beneficios_de_indicacao.indicador_nome IS
  'Quem indicou, quando não era cliente da carteira (L2962). Dado pessoal de '
  'terceiro, com a retenção do lead que o gerou (retencao.md). Continua '
  'gravado depois de o benefício ser ligado a um cliente: é o histórico de '
  'quem indicou.';


-- ---------------------------------------------------------------------------
-- PARTE 4 — Lista de supressão (LGPD A37).
--
-- Quem pede exclusão sai da base: o lead é anonimizado e o telefone fica só
-- como HMAC (chave fora do banco), para não ser reimportado nem recontatado.
-- Global, sem grupo: a oposição é à Firmare, não a uma equipe.
--
-- Ninguém além do dono lê ou escreve a tabela: RLS forçada SEM policy e sem
-- GRANT. As duas portas são funções SECURITY DEFINER estreitas — uma
-- responde só "está suprimido?" para UM hash, a outra anonimiza um lead
-- visível pela sessão e guarda o hash. Não há como listar a tabela.
-- ---------------------------------------------------------------------------

CREATE TABLE supressoes_de_contato (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- HMAC-SHA-256 hexadecimal do telefone normalizado (`normalizarTelefoneDoLead`).
  telefone_hash text NOT NULL UNIQUE CHECK (telefone_hash ~ '^[0-9a-f]{64}$'),
  motivo        text NOT NULL CHECK (motivo IN ('exclusao_a_pedido')),
  criado_em     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE supressoes_de_contato IS
  'Lista de supressão da prospecção (LGPD A37): só o HMAC do telefone de '
  'quem pediu exclusão. Sem nome, sem lead, sem grupo. Lida e escrita só por '
  'contato_de_lead_suprimido() e excluir_lead_a_pedido().';

ALTER TABLE supressoes_de_contato ENABLE ROW LEVEL SECURITY;
ALTER TABLE supressoes_de_contato FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON supressoes_de_contato FROM PUBLIC;
REVOKE ALL ON supressoes_de_contato FROM fir_app;
REVOKE ALL ON supressoes_de_contato FROM fir_carteira;

CREATE FUNCTION contato_de_lead_suprimido(p_hash text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM supressoes_de_contato WHERE telefone_hash = p_hash)
$$;

COMMENT ON FUNCTION contato_de_lead_suprimido(text) IS
  'Responde só se UM hash está na lista de supressão (A37). Não lista nada.';

REVOKE ALL ON FUNCTION contato_de_lead_suprimido(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION contato_de_lead_suprimido(text) TO fir_carteira;

-- Exclusão a pedido do titular. Anonimiza o lead (mantém etapa, origem,
-- produto e datas: a contagem do funil não muda), apaga o texto das
-- interações — que são append-only para a aplicação e por isso só esta
-- função as reescreve —, marca `nao_contatar` e arquiva. Lead convertido é
-- recusado: o dado dele passou para a classe do cliente (retenção).
--
-- O que ela NÃO alcança, e fica como pendência escrita no relatório do
-- ticket: o `de` da `auditoria_do_painel` das escritas anteriores no lead
-- guarda os valores antigos. Apagá-los é do job privilegiado de retenção.
CREATE FUNCTION excluir_lead_a_pedido(p_lead_id uuid, p_hash text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_cru  text := coalesce(current_setting('app.pessoa_id', true), '');
  v_tipo text;
  v_ator uuid;
  v_lead record;
BEGIN
  IF v_cru = '' THEN
    RAISE EXCEPTION 'excluir_lead_a_pedido: ator não declarado' USING ERRCODE = '42501';
  END IF;
  SELECT tipo, ator INTO v_tipo, v_ator FROM auditoria_resolver_ator(v_cru);
  IF v_tipo IS DISTINCT FROM 'usuario_gestao' THEN
    RAISE EXCEPTION 'excluir_lead_a_pedido: só um Usuário de Gestão exclui lead'
      USING ERRCODE = '42501';
  END IF;
  IF p_hash IS NOT NULL AND p_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'excluir_lead_a_pedido: hash inválido' USING ERRCODE = '22023';
  END IF;

  SELECT id, grupo_id, etapa, cliente_carteira_id
    INTO v_lead
    FROM leads_comerciais
   WHERE id = p_lead_id
     FOR UPDATE;
  -- SECURITY DEFINER não passa pela RLS: a visibilidade é conferida aqui,
  -- com a MESMA função da policy, e "não visível" responde como "não existe".
  IF NOT FOUND OR NOT app_pode_ver_grupo(v_lead.grupo_id) THEN
    RAISE EXCEPTION 'excluir_lead_a_pedido: lead não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_lead.cliente_carteira_id IS NOT NULL THEN
    RAISE EXCEPTION 'excluir_lead_a_pedido: lead convertido em cliente' USING ERRCODE = '22023';
  END IF;

  UPDATE leads_comerciais
     SET nome = 'Lead excluído a pedido',
         especialidade = NULL, clinica = NULL, cidade = NULL,
         whatsapp = NULL, instagram = NULL, indicado_por = NULL,
         observacoes = NULL, proximo_contato = NULL,
         motivo_perda = CASE WHEN etapa = 'perdido' THEN 'Excluído a pedido do titular' ELSE NULL END,
         nao_contatar = true,
         nao_contatar_em = coalesce(nao_contatar_em, now()),
         excluido_a_pedido_em = coalesce(excluido_a_pedido_em, now()),
         arquivado_em = coalesce(arquivado_em, now())
   WHERE id = p_lead_id;

  UPDATE interacoes_do_lead
     SET nota = '[removido a pedido do titular]'
   WHERE lead_comercial_id = p_lead_id;

  IF p_hash IS NOT NULL THEN
    INSERT INTO supressoes_de_contato (telefone_hash, motivo)
    VALUES (p_hash, 'exclusao_a_pedido')
    ON CONFLICT (telefone_hash) DO NOTHING;
  END IF;
END $$;

COMMENT ON FUNCTION excluir_lead_a_pedido(uuid, text) IS
  'Exclusão a pedido do titular (LGPD A37): anonimiza o lead visível pela '
  'sessão e as interações dele, e guarda o HMAC do telefone na supressão.';

REVOKE ALL ON FUNCTION excluir_lead_a_pedido(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION excluir_lead_a_pedido(uuid, text) TO fir_carteira;

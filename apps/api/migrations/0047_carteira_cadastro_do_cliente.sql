-- ===========================================================================
-- G8, TICKET 0.4 — CADASTRO COMPLETO DO `Cliente Firmare` (item C3).
--
-- Inventário `docs/specs/g8-paridade-gestao-inventario.md` (C3, achados 2, 3
-- e 8 da §0); protótipo `F.cliente` (index.html L2745–2755) e `fCliente`
-- (L2771); D-22 itens 3, 4 e 10; gate LGPD A27–A34; gate appsec A-6, A-8,
-- A-11 (itens 5–7) e A-20; gate de números (mensalidade em centavos,
-- `dia_vencimento` 1–31, regra 25).
--
-- Forward-only, EXPAND: colunas novas anuláveis (ou com default constante),
-- uma tabela nova, um CHECK removido (D-22 item 4 — só afrouxa), triggers e
-- grants novos. Nenhuma migration aplicada é editada; nada é destruído.
--
-- O QUE FICA DE FORA, de propósito (cada um tem dono ou regra):
--  * `saude` (Saúde do cliente): é DERIVADA do checkin/reunião mais recente
--    (CONTEXT.md, "Saúde do cliente (derivada)") — nunca um campo que se
--    edita na ficha, embora o protótipo o tenha no formulário.
--  * `codigo_rotina` ("Código da clínica na Gestão de Rotina"): não
--    atravessa — o vínculo é `clinica_id` (ADR 0012 item 4).
--  * `link_planilha`: é `planilhas_do_cliente` (0045, ticket 4A).
--  * `valor_mensal`: já existe como `mensalidade_centavos` (0031).
--  * Os quatro links: já existem (0036).
--  * Ano do aniversário: LGPD A28 — dia e mês bastam para o lembrete, e o
--    "Parabenizar" não precisa da idade.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- PARTE 1 — D-22 item 4: um `Cliente Firmare` pode ficar ATIVO sem clínica.
--
-- O CHECK da 0032 (`status = 'onboarding' OR clinica_id IS NOT NULL`)
-- contradiz o CONTEXT.md ("pode existir sem nunca haver uma Clinica") e o
-- protótipo, que tem clientes ativos que não são clínica (Alumilider,
-- indústria; Connecta, imobiliária — L941, L946). Remover só afrouxa: toda
-- linha que passava continua passando.
-- ---------------------------------------------------------------------------
ALTER TABLE clientes_carteira DROP CONSTRAINT clientes_carteira_onboarding_sem_clinica;

COMMENT ON COLUMN clientes_carteira.clinica_id IS
  'Nullable e único. Um Cliente Firmare pode existir — e ficar ativo — sem '
  'nunca ter uma Clinica (D-22 item 4, 0047). Ligar a uma Clinica é só do '
  'Operador, e obedece ao grupo da clínica (trigger '
  'clientes_carteira_confere_vinculos, A-8).';


-- ---------------------------------------------------------------------------
-- PARTE 2 — As colunas do cadastro (F.cliente, L2745–2755).
--
-- Texto livre: `NULL` é "não informado"; string vazia nunca entra (o CHECK de
-- cada coluna exige ao menos um caractere que não seja espaço). O limite de
-- tamanho mora aqui E no contrato — o do contrato é o que a tela mostra, o
-- daqui é o que nem um bug deixa passar.
-- ---------------------------------------------------------------------------
ALTER TABLE clientes_carteira
  -- "Responsável Firmare" (`colaboradora_id`). Validado no MESMO grupo do
  -- cliente, ou `escopo='geral'`, e ativo (A-11 item 7) — no service e,
  -- como segunda camada, no trigger abaixo.
  ADD COLUMN responsavel_usuario_gestao_id uuid REFERENCES usuarios_gestao(id),
  ADD COLUMN segmento  text CHECK (length(btrim(segmento)) BETWEEN 1 AND 80),
  ADD COLUMN cidade    text CHECK (length(btrim(cidade)) BETWEEN 1 AND 80),
  -- "Decisor no cliente" (`responsavel` no protótipo). Nome próprio, para
  -- não colidir com o Responsável Firmare acima.
  ADD COLUMN decisor   text CHECK (length(btrim(decisor)) BETWEEN 1 AND 120),
  -- "Aniversário da médica ou decisora": DIA e MÊS, nunca o ano (LGPD A28,
  -- art. 7º IX com LIA). Validação conjunta no CHECK de tabela abaixo.
  ADD COLUMN aniversario_decisor_dia smallint CHECK (aniversario_decisor_dia BETWEEN 1 AND 31),
  ADD COLUMN aniversario_decisor_mes smallint CHECK (aniversario_decisor_mes BETWEEN 1 AND 12),
  ADD COLUMN telefone  text CHECK (length(btrim(telefone)) BETWEEN 1 AND 30),
  ADD COLUMN email     text CHECK (length(btrim(email)) BETWEEN 3 AND 160),
  -- Só os 14 dígitos: a máscara é da tela.
  ADD COLUMN cnpj      text CHECK (cnpj ~ '^[0-9]{14}$'),
  -- AREAS (L515). O produto continua texto livre: a conversão de lead grava
  -- 'A definir no onboarding' (0042), e dado real já existe com outros nomes.
  -- A lista de PRODUTOS (L516) é cobrada no contrato de escrita.
  ADD COLUMN area_foco text CHECK (area_foco IN
    ('Comercial', 'Financeiro', 'Pessoas', 'Processos', 'Estratégia', 'Gestão')),
  ADD COLUMN projeto   text CHECK (length(btrim(projeto)) BETWEEN 1 AND 80),
  -- "Quem paga, se não for a cliente" — dado de TERCEIRO (LGPD A32).
  ADD COLUMN pagador   text CHECK (length(btrim(pagador)) BETWEEN 1 AND 120),
  -- "Reunião fixa": dia da semana ISO (1 = segunda … 7 = domingo) e hora,
  -- ESTRUTURADOS (PP-7) — nunca o texto "terça 10h" que o protótipo precisa
  -- reinterpretar com `DIAN` (L748).
  ADD COLUMN reuniao_dia_semana smallint CHECK (reuniao_dia_semana BETWEEN 1 AND 7),
  ADD COLUMN reuniao_hora       time,
  -- A partir de quando as reuniões semanais geram tarefa (R11, L902, L2351).
  ADD COLUMN reunioes_inicio date,
  -- Ciclo do contrato. Sem `data_fim` = "Recorrente" (V2, L1409–1423).
  ADD COLUMN data_inicio  date,
  ADD COLUMN data_fim     date,
  -- "Cliente da Firmare desde" (C6, L1733): a cliente que já era da Firmare
  -- antes desta ferramenta.
  ADD COLUMN cliente_desde date,
  -- SERVICOS (L628): define quais rotinas geram tarefa para a cliente (R11).
  ADD COLUMN servicos text[] NOT NULL DEFAULT '{}'
    CHECK (servicos <@ ARRAY['semanal', 'fluxo', 'dre']::text[]),
  -- Texto livre que pode trazer paciente: aviso fixo na tela, limite aqui e
  -- no contrato, nunca em log nem em mensagem de erro (LGPD A31).
  ADD COLUMN observacoes text CHECK (length(btrim(observacoes)) BETWEEN 1 AND 2000),
  -- Seção PAGAMENTO (só com `valores`, L2771 e LGPD A30). `dia_vencimento`
  -- 1–31: dia 29/30/31 cai no último dia do mês curto (regra 25) — a conta
  -- é do domínio (`vencimentoDaCompetencia`), nunca desta coluna.
  ADD COLUMN dia_vencimento smallint CHECK (dia_vencimento BETWEEN 1 AND 31),
  ADD COLUMN telefone_cobranca text CHECK (length(btrim(telefone_cobranca)) BETWEEN 1 AND 30),
  -- A-20: a chave que o formulário de "Novo cliente" gera uma vez e reenvia
  -- no duplo clique/retry. O segundo POST devolve o MESMO cliente.
  ADD COLUMN chave_de_criacao uuid;

ALTER TABLE clientes_carteira
  -- Dia e mês juntos, ou nenhum dos dois; e o dia existe naquele mês
  -- (29/02 vale — o aniversário não tem ano).
  ADD CONSTRAINT clientes_carteira_aniversario_valido CHECK (
    (aniversario_decisor_dia IS NULL) = (aniversario_decisor_mes IS NULL)
    AND (aniversario_decisor_dia IS NULL OR aniversario_decisor_dia <=
         CASE aniversario_decisor_mes WHEN 2 THEN 29 WHEN 4 THEN 30 WHEN 6 THEN 30
                                      WHEN 9 THEN 30 WHEN 11 THEN 30 ELSE 31 END)
  ),
  -- Hora sem dia não é reunião fixa.
  ADD CONSTRAINT clientes_carteira_reuniao_tem_dia CHECK (
    reuniao_hora IS NULL OR reuniao_dia_semana IS NOT NULL
  ),
  ADD CONSTRAINT clientes_carteira_ciclo_em_ordem CHECK (
    data_inicio IS NULL OR data_fim IS NULL OR data_fim >= data_inicio
  );

CREATE UNIQUE INDEX clientes_carteira_chave_de_criacao_unica
  ON clientes_carteira (chave_de_criacao) WHERE chave_de_criacao IS NOT NULL;

CREATE INDEX clientes_carteira_por_responsavel
  ON clientes_carteira (responsavel_usuario_gestao_id)
  WHERE responsavel_usuario_gestao_id IS NOT NULL AND excluido_em IS NULL;

COMMENT ON COLUMN clientes_carteira.observacoes IS
  'Texto livre do cadastro. Pode conter dado pessoal de terceiro: aviso fixo '
  '"Não registre dado de paciente." na tela; nunca em log (LGPD A31).';
COMMENT ON COLUMN clientes_carteira.dia_vencimento IS
  'Dia do vencimento da mensalidade, 1–31. Em mês curto, vence no último dia '
  '(regra 25, domínio). Campo da seção Pagamento: só com valores (A30, A-6).';
COMMENT ON COLUMN clientes_carteira.telefone_cobranca IS
  'WhatsApp para cobrança, se diferente do telefone. Seção Pagamento: só com '
  'valores (A30). Retenção: vigência + 90 dias (retencao.md).';
COMMENT ON COLUMN clientes_carteira.pagador IS
  'Quem paga, se não for a cliente. Dado de terceiro (LGPD A32).';
COMMENT ON COLUMN clientes_carteira.reuniao_dia_semana IS
  'Dia ISO da reunião fixa: 1 = segunda … 7 = domingo (PP-7).';


-- ---------------------------------------------------------------------------
-- PARTE 3 — A-8: os vínculos de um `Cliente Firmare`, no banco.
--
-- `clinicas` ainda não tem `grupo_id` (G1b, depois do épico 9 — CONTEXT.md,
-- "Criar clínica, unificado"). Até lá, o grupo de uma clínica é o que a
-- própria trilha de tenancy diz: a linha mais recente de
-- `historico_grupo_da_clinica` (0025, append-only). Toda escrita que liga
-- uma clínica a um cliente, ou muda o grupo de um cliente com clínica, grava
-- essa linha ANTES, na mesma transação (`PainelCarteiraService`).
--
-- O trigger cobra três coisas, como segunda camada do service:
--  1. Só o Operador (ou `sistema`) muda `grupo_id`/`clinica_id`. O `Usuário
--     de Gestão` nunca — nem dentro do próprio escopo (A-11 itens 5 e 6).
--  2. Cliente com clínica fica no grupo da clínica: um cliente do grupo X
--     ligado a uma clínica do grupo Y faria os jobs de uso e de campanha
--     (que resolvem o grupo por `clientes_carteira.clinica_id`, ADR 0012 §3)
--     escreverem dado da clínica Y no grupo X.
--  3. O Responsável Firmare é do mesmo grupo do cliente (ou `geral`) e está
--     ativo (A-11 item 7, ADR 0016 §2).
--
-- SECURITY DEFINER: lê `historico_grupo_da_clinica` (RLS por clínica) e
-- `usuarios_gestao` independentemente da sessão. Só LÊ.
-- ---------------------------------------------------------------------------
CREATE FUNCTION clientes_carteira_confere_vinculos() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_ator            text := coalesce(current_setting('app.pessoa_id', true), '');
  v_grupo_clinica   uuid;
  v_resp_grupo      uuid;
  v_resp_escopo     text;
  v_resp_ativo      boolean;
BEGIN
  IF v_ator LIKE 'usuario_gestao:%' THEN
    IF TG_OP = 'INSERT' AND NEW.clinica_id IS NOT NULL THEN
      RAISE EXCEPTION 'só o Operador liga um Cliente Firmare a uma clínica'
        USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.grupo_id IS DISTINCT FROM OLD.grupo_id
                             OR NEW.clinica_id IS DISTINCT FROM OLD.clinica_id) THEN
      RAISE EXCEPTION 'só o Operador muda o grupo ou a clínica de um Cliente Firmare'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.clinica_id IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR NEW.clinica_id IS DISTINCT FROM OLD.clinica_id
          OR NEW.grupo_id IS DISTINCT FROM OLD.grupo_id) THEN
    SELECT h.grupo_novo_id INTO v_grupo_clinica
      FROM historico_grupo_da_clinica h
     WHERE h.clinica_id = NEW.clinica_id
     ORDER BY h.mudado_em DESC, h.id DESC
     LIMIT 1;
    IF v_grupo_clinica IS NOT NULL AND v_grupo_clinica <> NEW.grupo_id THEN
      RAISE EXCEPTION 'a clínica pertence a outro grupo'
        USING ERRCODE = '23514', CONSTRAINT = 'clientes_carteira_grupo_da_clinica';
    END IF;
  END IF;

  IF NEW.responsavel_usuario_gestao_id IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR NEW.responsavel_usuario_gestao_id IS DISTINCT FROM OLD.responsavel_usuario_gestao_id
          OR NEW.grupo_id IS DISTINCT FROM OLD.grupo_id) THEN
    SELECT u.grupo_id, u.escopo, u.ativo INTO v_resp_grupo, v_resp_escopo, v_resp_ativo
      FROM usuarios_gestao u WHERE u.id = NEW.responsavel_usuario_gestao_id;
    IF NOT FOUND OR NOT v_resp_ativo
       OR (v_resp_escopo = 'grupo' AND v_resp_grupo IS DISTINCT FROM NEW.grupo_id) THEN
      RAISE EXCEPTION 'o responsável Firmare não é deste grupo ou não está ativo'
        USING ERRCODE = '23514', CONSTRAINT = 'clientes_carteira_responsavel_do_grupo';
    END IF;
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION clientes_carteira_confere_vinculos() IS
  'A-8/A-11 (0047): grupo/clínica só pelo Operador; cliente com clínica no '
  'grupo da clínica (última linha de historico_grupo_da_clinica); responsável '
  'Firmare do mesmo grupo e ativo. Segunda camada do service.';

CREATE TRIGGER clientes_carteira_confere_vinculos
  BEFORE INSERT OR UPDATE ON clientes_carteira
  FOR EACH ROW EXECUTE FUNCTION clientes_carteira_confere_vinculos();


-- ---------------------------------------------------------------------------
-- PARTE 4 — `parceiros_do_cliente` (LGPD A29, inventário C3).
--
-- "Parceiros e formulários de cada frente" (L2753): por frente (FRENTES,
-- L629), o parceiro, o WhatsApp dele e o link do formulário. Tabela própria,
-- nunca doze colunas soltas. Dado de TERCEIRO coletado de forma indireta:
-- art. 7º IX com LIA e aviso; só estes quatro campos (A29); nunca na
-- exportação do titular (A33).
--
-- NÃO é append-only: o parceiro substituído é sobrescrito (o de→para fica na
-- trilha) e a frente esvaziada é eliminada — é a ação de fim da linha de
-- retenção ("eliminar a linha"), não uma exclusão de dado financeiro.
--
-- A-8: FK composta `(cliente_carteira_id, grupo_id)` com `ON UPDATE
-- CASCADE` — o grupo do parceiro nunca diverge do grupo do cliente, e mover
-- o cliente de grupo (só o Operador) leva os parceiros na mesma instrução.
-- O índice único `(id, grupo_id)` já existe desde a 0044.
-- ---------------------------------------------------------------------------
CREATE TABLE parceiros_do_cliente (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id            uuid NOT NULL REFERENCES grupos(id),
  cliente_carteira_id uuid NOT NULL,
  frente              text NOT NULL CHECK (frente IN ('financeiro', 'comercial', 'trafego', 'marketing')),
  nome                text CHECK (length(btrim(nome)) BETWEEN 1 AND 120),
  whatsapp            text CHECK (length(btrim(whatsapp)) BETWEEN 1 AND 30),
  link_formulario     text CHECK (length(btrim(link_formulario)) BETWEEN 1 AND 500),
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now(),

  -- Uma linha vazia não é parceiro: esvaziar a frente é eliminar a linha.
  CONSTRAINT parceiros_do_cliente_nao_vazio CHECK (
    nome IS NOT NULL OR whatsapp IS NOT NULL OR link_formulario IS NOT NULL
  ),
  -- Um parceiro por frente por cliente (L2753: `resp_<frente>`). É também a
  -- chave do upsert idempotente (A-20).
  CONSTRAINT parceiros_do_cliente_uma_por_frente UNIQUE (cliente_carteira_id, frente),
  CONSTRAINT parceiros_do_cliente_cliente_do_grupo
    FOREIGN KEY (cliente_carteira_id, grupo_id)
    REFERENCES clientes_carteira (id, grupo_id)
    ON UPDATE CASCADE
);

COMMENT ON TABLE parceiros_do_cliente IS
  'Parceiro de cada frente (financeiro, comercial, tráfego, marketing) de um '
  'Cliente Firmare: nome, WhatsApp e link do formulário. Dado de terceiro '
  '(LGPD A29, art. 7º IX): só estes campos, nunca na exportação do titular '
  '(A33), eliminado na substituição/encerramento + 90 dias (retencao.md).';

CREATE INDEX parceiros_do_cliente_por_grupo ON parceiros_do_cliente (grupo_id);

ALTER TABLE parceiros_do_cliente ENABLE ROW LEVEL SECURITY;
ALTER TABLE parceiros_do_cliente FORCE  ROW LEVEL SECURITY;
-- `TO fir_carteira` explícito (lição da 0035: policy sem TO vale PUBLIC).
-- Sem policy nem GRANT para `fir_portal`: o portal não lê terceiros.
CREATE POLICY parceiros_do_cliente_por_grupo ON parceiros_do_cliente
  TO fir_carteira
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

REVOKE ALL ON parceiros_do_cliente FROM fir_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON parceiros_do_cliente TO fir_carteira;

-- A trilha (regra 20): tabela sem `clinica_id` → `auditoria_do_painel`,
-- como as de G5. A escrita roda com `app.pessoa_id = 'usuario_gestao:<id>'`.
CREATE TRIGGER parceiros_do_cliente_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON parceiros_do_cliente
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria_do_painel();


-- ---------------------------------------------------------------------------
-- PARTE 5 — O portal NÃO lê o cadastro interno (A-7, LGPD A33).
--
-- `GRANT SELECT ON clientes_carteira TO fir_portal` (0034) é de TABELA, e
-- por isso alcançaria toda coluna nova desta migration: observações, decisor,
-- pagador, telefone de cobrança. Troca por privilégio de COLUNA, exatamente
-- as colunas que existiam antes — nenhuma leitura do portal muda
-- (`leitura-do-portal.service.ts` seleciona por lista explícita). Coluna nova
-- que o portal precisar entra por GRANT próprio, no ticket que a mostra.
-- ---------------------------------------------------------------------------
REVOKE SELECT ON clientes_carteira FROM fir_portal;
GRANT SELECT (id, grupo_id, clinica_id, nome, produto, status, criado_em, excluido_em,
              mensalidade_centavos, link_painel, link_dash_ind, link_dash_fin, link_rotina,
              lead_origem_id)
  ON clientes_carteira TO fir_portal;


-- ---------------------------------------------------------------------------
-- PARTE 6 — Mover um cliente de grupo (A-11 item 6, só o Operador).
--
-- A mudança reescreve o `grupo_id` das filhas numa instrução só
-- (`PainelCarteiraService.mudarDeGrupo`) e revoga as sessões do portal dos
-- usuários de escopo `cliente` daquele cliente. Dois privilégios estreitos,
-- de COLUNA, que faltavam a `fir_carteira`:
--  * `interacoes_do_lead.grupo_id` — a interação acompanha o lead do cliente;
--  * `sessoes_do_portal.revogada_em` — só revogar, nunca criar nem ler token.
-- ---------------------------------------------------------------------------
GRANT UPDATE (grupo_id) ON interacoes_do_lead TO fir_carteira;
GRANT SELECT (id, usuario_portal_id, revogada_em), UPDATE (revogada_em)
  ON sessoes_do_portal TO fir_carteira;

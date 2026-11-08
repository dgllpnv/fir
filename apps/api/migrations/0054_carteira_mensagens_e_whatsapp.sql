-- ===========================================================================
-- G8, TICKET 3A — mensagens prontas e WhatsApp, igual ao protótipo.
-- Inventário `docs/specs/g8-paridade-gestao-inventario.md` (X4, W1, W2, W4,
-- $3, L9, L10, L13); gates appsec A-14 e A-19, LGPD A35–A39, PP-6.
--
-- Forward-only, EXPAND: três tabelas globais da Firmare (A-19), uma tabela
-- de fato (o envio), e duas colunas novas em `parceiros_do_cliente`.
-- ===========================================================================

-- O trigger de auditoria exige ator declarado; a semente abaixo é a migration.
SELECT set_config('app.pessoa_id', 'sistema', true);


-- ---------------------------------------------------------------------------
-- PARTE 1 — `mensagens_comerciais`: os modelos de mensagem (X4,
-- `mensagensPadrao` L834-841). Conteúdo da Firmare, sem tenant (A-19):
-- leitura liberada para a carteira (quem é de um grupo também envia), escrita
-- só `escopo = 'geral'`. Quando o ticket 0.5 criar `carteira.administrar`, a
-- policy de escrita ganha a condição por AND.
--
-- Sem "excluir": o protótipo não tem (L2659). Chave estável: é por ela que a
-- rotina e o checklist apontam o modelo (L2568).
-- ---------------------------------------------------------------------------
CREATE TABLE mensagens_comerciais (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave         text NOT NULL UNIQUE CHECK (chave ~ '^[a-z0-9_]{1,40}$'),
  titulo        text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 120),
  texto         text NOT NULL CHECK (length(btrim(texto)) BETWEEN 1 AND 4000),
  criado_por    uuid REFERENCES usuarios_gestao(id),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz
);

COMMENT ON TABLE mensagens_comerciais IS
  'Modelos de mensagem da carteira (G8 X4): texto com variáveis, preenchido no '
  'servidor numa passada só (appsec A-14). Global da Firmare (A-19). Sem dado '
  'pessoal: o preenchimento acontece na hora e o texto montado não é guardado.';

ALTER TABLE mensagens_comerciais ENABLE ROW LEVEL SECURITY;
ALTER TABLE mensagens_comerciais FORCE  ROW LEVEL SECURITY;

CREATE POLICY mensagens_comerciais_leitura ON mensagens_comerciais
  FOR SELECT TO fir_carteira
  USING (true);
CREATE POLICY mensagens_comerciais_criacao ON mensagens_comerciais
  FOR INSERT TO fir_carteira
  WITH CHECK (app_escopo() = 'geral');
CREATE POLICY mensagens_comerciais_edicao ON mensagens_comerciais
  FOR UPDATE TO fir_carteira
  USING (app_escopo() = 'geral')
  WITH CHECK (app_escopo() = 'geral');

REVOKE ALL ON mensagens_comerciais FROM fir_app;
GRANT SELECT, INSERT, UPDATE ON mensagens_comerciais TO fir_carteira;

CREATE TRIGGER mensagens_comerciais_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON mensagens_comerciais
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria_do_painel();

-- Semente idempotente por chave (T8, regra 26): os sete modelos do protótipo,
-- texto literal de L835-841.
INSERT INTO mensagens_comerciais (chave, titulo, texto) VALUES
  ('pagamento', 'Lembrete de pagamento',
   E'Olá, {responsavel}! Tudo bem? Aqui é a {remetente}, da Firmare.\nPassando para lembrar que a mensalidade de {mes}, no valor de {valor}, vence no dia {vencimento}.\n\nDados para pagamento:\nPix: {pix}\nFavorecido: {favorecido}\n\nSe o pagamento já foi feito, pode desconsiderar esta mensagem. Obrigada!'),
  ('fluxo', 'Fluxo de caixa disponível',
   E'Olá, {responsavel}! Tudo bem? O relatório de fluxo de caixa de {mes_ref} já está disponível para acompanhamento neste link:\n{link_dash_financeiro}\n\nQualquer dúvida, fico à disposição.'),
  ('dre', 'DRE atualizada',
   E'Olá, {responsavel}! Tudo bem? A DRE de {mes_ref} já se encontra atualizada no dash financeiro:\n{link_dash_financeiro}\n\nOs gráficos já refletem os números do mês.'),
  ('formulario', 'Formulário semanal para o parceiro',
   E'Olá, {parceiro}! Tudo bem? Aqui é a {remetente}, da Firmare.\nSegue o link do formulário semanal de {frente} ({cliente}):\n{link_form}\n\nPara o relatório da semana ficar completo, o preenchimento precisa ser feito até segunda pela manhã. Obrigada!'),
  ('cobranca', 'Cobrança do formulário ao parceiro',
   E'Olá, {parceiro}! Tudo bem? Ainda não recebemos o formulário de {frente} desta semana ({cliente}), e o relatório está aguardando essa informação. Consegue enviar hoje? O link é este:\n{link_form}\n\nObrigada!'),
  ('acessos', 'Acessos da cliente',
   E'Olá, {responsavel}! Tudo bem? Seguem os seus acessos da Firmare, para salvar e consultar sempre que precisar:\n\nPainel do cliente, com todos os seus documentos:\n{link_painel}\n\nDash financeiro:\n{link_dash_financeiro}\n\nDash de indicadores:\n{link_dash_indicadores}\n\nGestor de rotinas:\n{link_gestor_rotina}\n\nQualquer dúvida, estou à disposição.'),
  ('semanal', 'Relatório semanal atualizado',
   E'Olá, {responsavel}! Tudo bem? Os relatórios da semana já se encontram atualizados com as informações recebidas, no dash de indicadores:\n{link_dash_indicadores}\n\n{pendencias}')
ON CONFLICT (chave) DO NOTHING;


-- ---------------------------------------------------------------------------
-- PARTE 2 — `roteiros_comerciais`: os roteiros de abordagem do lead (L9,
-- L10, `roteirosPadrao` L534-560). NÃO é o roteiro de briefing (3E, conteúdo
-- estático da tela). Mesma RLS global de A-19.
--
-- "Excluir" do protótipo (L2860) vira `arquivado_em` (regra 20).
--
-- LGPD A39 no BANCO, não só na tela: o roteiro do primeiro contato precisa
-- da variável que diz de onde veio o contato. Divergência do protótipo, que
-- só citava quem indicou num trecho opcional `[[…]]` — lead do Instagram
-- recebia a primeira mensagem sem saber de onde a Firmare tirou o número.
-- ---------------------------------------------------------------------------
CREATE TABLE roteiros_comerciais (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- `primeiro`, `agendar`… nos oito padrão (o sinal do lead aponta por ela,
  -- `sinalDoLead`); NULL nos criados pela diretoria (L2955 grava chave "").
  chave         text UNIQUE CHECK (chave ~ '^[a-z0-9_]{1,40}$'),
  titulo        text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 120),
  quando        text NOT NULL DEFAULT '' CHECK (length(quando) <= 200),
  mensagem      text NOT NULL DEFAULT '' CHECK (length(mensagem) <= 4000),
  passos        text[] NOT NULL DEFAULT '{}' CHECK (cardinality(passos) <= 30),
  ordem         integer NOT NULL DEFAULT 1000,
  criado_por    uuid REFERENCES usuarios_gestao(id),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz,
  arquivado_em  timestamptz,

  CONSTRAINT roteiros_primeiro_contato_diz_a_origem CHECK (
    chave IS DISTINCT FROM 'primeiro' OR position('{origem_do_contato}' IN mensagem) > 0
  ),
  -- O roteiro padrão não é arquivado: o sinal do lead aponta para ele.
  CONSTRAINT roteiros_padrao_nao_arquiva CHECK (chave IS NULL OR arquivado_em IS NULL)
);

COMMENT ON TABLE roteiros_comerciais IS
  'Roteiros de abordagem comercial do lead (G8 L9/L10): mensagem com variáveis '
  'e passo a passo. Global da Firmare (A-19). Arquivar em vez de excluir.';

ALTER TABLE roteiros_comerciais ENABLE ROW LEVEL SECURITY;
ALTER TABLE roteiros_comerciais FORCE  ROW LEVEL SECURITY;

CREATE POLICY roteiros_comerciais_leitura ON roteiros_comerciais
  FOR SELECT TO fir_carteira
  USING (true);
CREATE POLICY roteiros_comerciais_criacao ON roteiros_comerciais
  FOR INSERT TO fir_carteira
  WITH CHECK (app_escopo() = 'geral');
CREATE POLICY roteiros_comerciais_edicao ON roteiros_comerciais
  FOR UPDATE TO fir_carteira
  USING (app_escopo() = 'geral')
  WITH CHECK (app_escopo() = 'geral');

REVOKE ALL ON roteiros_comerciais FROM fir_app;
GRANT SELECT, INSERT, UPDATE ON roteiros_comerciais TO fir_carteira;

CREATE TRIGGER roteiros_comerciais_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON roteiros_comerciais
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria_do_painel();

INSERT INTO roteiros_comerciais (chave, titulo, quando, mensagem, passos, ordem) VALUES
  ('primeiro', 'Primeiro contato', 'Indicação recebida, ainda sem conversa',
   'Olá, {nome}! Tudo bem? Aqui é a {remetente}, da Firmare Gestão Empresarial. {origem_do_contato} Trabalhamos com gestão estratégica de clínicas e acredito que uma conversa de 20 minutos pode ser útil para você. Qual o melhor dia nesta semana?',
   ARRAY['Abrir citando quem indicou. É isso que garante a resposta.',
         'O objetivo da mensagem é só marcar a conversa. Não falar de preço nem de produto por escrito.',
         'Se responder, oferecer dois horários fechados em vez de perguntar a agenda.',
         'Sem resposta em 2 dias: mandar um áudio curto, de até 30 segundos.',
         'Sem resposta em mais 5 dias: pedir a quem indicou um reforço.',
         'Registrar o contato e marcar a data do próximo passo.'], 10),
  ('agendar', 'Marcar a reunião', 'Em conversa, ainda sem reunião marcada',
   'Olá, {nome}! Que bom falar com você. Para entender melhor a realidade da clínica, que tal uma conversa de 20 minutos? Tenho disponibilidade na terça às 10h ou na quinta às 15h. Qual fica melhor para você?',
   ARRAY['Sempre oferecer dois horários fechados.',
         'Enviar o link da chamada ou o endereço logo após a confirmação.',
         'Mover para Reunião agendada e colocar a data em Próximo contato.',
         'Confirmar na véspera com a mensagem de confirmação.'], 20),
  ('confirmacao', 'Confirmar a reunião', 'Véspera ou dia da reunião',
   'Olá, {nome}! Passando para confirmar nossa conversa. Está mantido? Qualquer imprevisto, me avise que remarcamos.',
   ARRAY['Enviar na véspera, no início da manhã.',
         'Se não confirmar até o meio do dia, ligar.',
         'Se remarcar, já sugerir a nova data na mesma mensagem.'], 30),
  ('diagnostico', 'Roteiro da reunião', 'Durante a conversa de apresentação',
   'Olá, {nome}! Obrigada pela conversa de hoje. Como combinamos, vou preparar uma proposta a partir do que você me contou e envio nos próximos dias.',
   ARRAY['Abertura (2 min): agradecer, citar quem indicou e explicar como será a conversa.',
         'Momento atual: como está a agenda hoje? Quantas pessoas trabalham na clínica? Qual o faturamento médio por mês?',
         'Dor principal: o que mais tira seu tempo ou seu sono na gestão hoje?',
         'Tentativas: você já tentou resolver isso? O que aconteceu?',
         'Impacto: se isso estivesse resolvido em 4 meses, o que mudaria para você?',
         'Apresentação: mostrar o Método FIR ligado à dor que ela contou, sem apresentar tudo.',
         'Próximo passo: combinar a data de envio da proposta e uma nova conversa para apresentá-la.',
         'Depois da reunião: registrar o resumo aqui e enviar a mensagem de agradecimento.'], 40),
  ('proposta', 'Acompanhar a proposta', 'Proposta enviada, aguardando resposta',
   'Olá, {nome}! Tudo bem? Passando para saber se conseguiu olhar a proposta que enviei. Fico à disposição para ajustar o que for preciso ou tirar dúvidas numa ligação rápida.',
   ARRAY['Sempre que possível, apresentar a proposta em chamada em vez de só enviar o arquivo.',
         'Após 3 dias: mensagem leve perguntando se ficou alguma dúvida.',
         'Após 5 dias: ligar.',
         'Se pedir desconto, oferecer ajuste de escopo antes de mexer no preço.',
         'Combinar uma data limite para a condição apresentada.'], 50),
  ('objecoes', 'Respostas para objeções', 'Quando surgir resistência na conversa', '',
   ARRAY['Está caro: comparado a quê? Mostrar quanto custa continuar como está, em faturamento perdido por mês.',
         'Não tenho tempo agora: o método foi feito justamente para devolver tempo. A dedicação é de 1 hora por semana.',
         'Vou pensar: claro. O que ainda falta para você decidir? Combinar uma data para a resposta.',
         'Já tenho contador ou consultor: o trabalho é na gestão da rotina, do comercial e da equipe, e complementa o contador.',
         'Preciso falar com meu sócio: sugerir uma conversa rápida com os dois juntos.'], 60),
  ('retomada', 'Retomar o contato', 'Em espera ou com data combinada que chegou',
   'Olá, {nome}! Tudo bem? Como combinamos, estou retomando nossa conversa sobre a gestão da clínica. Faz sentido marcarmos um horário nos próximos dias?',
   ARRAY['Lembrar o que foi combinado da última vez (veja o histórico).',
         'Trazer uma novidade ou um resultado de cliente parecido.',
         'Se ainda não for o momento, combinar uma nova data e registrar.'], 70),
  ('agradecimento', 'Agradecer a indicação', 'Para quem indicou, quando a indicação vira cliente',
   'Olá, {indicador}! Passando para agradecer de coração a indicação de {nome}.[[ Como forma de agradecimento, você ganhou {beneficio}.]] Obrigada pela confiança no nosso trabalho!',
   ARRAY['Enviar no mesmo dia em que o contrato for fechado.',
         'Marcar o benefício como concedido quando for aplicado na mensalidade.'], 80)
ON CONFLICT (chave) DO NOTHING;


-- ---------------------------------------------------------------------------
-- PARTE 3 — `configuracao_da_carteira`: chave Pix e favorecido (`db.config`,
-- `bancoVazio` L1132; tela "Dados de pagamento da Firmare" L2655-2656).
-- Uma linha só (`unica`). Sem INSERT pela aplicação: a linha nasce aqui.
--
-- A chave Pix é dado de pagamento da Firmare: o SERVIÇO a devolve só para
-- quem tem `valores` e só deixa quem tem `valores` gravá-la (A-14, A35).
-- O benefício de indicação NÃO mora aqui ainda: a regra vigente é
-- `PERCENTUAL_DO_BENEFICIO_DE_INDICACAO` (beneficios.regra.ts), que a
-- conversão do lead fotografa. Pôr uma cópia editável aqui sem a conversão
-- lê-la deixaria a mensagem prometendo um desconto que a cobrança não dá.
-- ---------------------------------------------------------------------------
CREATE TABLE configuracao_da_carteira (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unica         boolean NOT NULL DEFAULT true UNIQUE CHECK (unica),
  chave_pix     text CHECK (chave_pix IS NULL OR length(btrim(chave_pix)) BETWEEN 1 AND 140),
  favorecido    text CHECK (favorecido IS NULL OR length(btrim(favorecido)) BETWEEN 1 AND 160),
  atualizado_em timestamptz
);

COMMENT ON TABLE configuracao_da_carteira IS
  'Configuração global da carteira (A-19), uma linha. chave_pix só sai e só é '
  'gravada por quem tem valores (serviço de mensagens).';

ALTER TABLE configuracao_da_carteira ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracao_da_carteira FORCE  ROW LEVEL SECURITY;

CREATE POLICY configuracao_da_carteira_leitura ON configuracao_da_carteira
  FOR SELECT TO fir_carteira
  USING (true);
CREATE POLICY configuracao_da_carteira_edicao ON configuracao_da_carteira
  FOR UPDATE TO fir_carteira
  USING (app_escopo() = 'geral')
  WITH CHECK (app_escopo() = 'geral');

REVOKE ALL ON configuracao_da_carteira FROM fir_app;
GRANT SELECT, UPDATE ON configuracao_da_carteira TO fir_carteira;

CREATE TRIGGER configuracao_da_carteira_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON configuracao_da_carteira
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria_do_painel();

-- O favorecido de fábrica do protótipo (L1047, L1063); a chave Pix começa vazia.
INSERT INTO configuracao_da_carteira (favorecido) VALUES ('Firmare Gestão Empresarial')
ON CONFLICT (unica) DO NOTHING;


-- ---------------------------------------------------------------------------
-- PARTE 4 — `envios_de_mensagem`: "Marcar como enviada" (W2, PP-6, LGPD A36).
--
-- Grava SÓ O FATO: quando, quem, qual modelo/roteiro, para que tipo de
-- destinatário. O TEXTO enviado NÃO é guardado (A36) — nem coluna existe.
-- Abrir o WhatsApp não prova o envio: a linha nasce da confirmação explícita
-- da pessoa, nunca do clique que abre a conversa (PP-6). É "a pessoa disse
-- que enviou", nunca "foi entregue".
--
-- Idempotente (A-14): a tela gera uma chave por modal aberto; repetir a
-- requisição devolve o mesmo registro. Append-only (regra 20).
--
-- Lead pode não ter grupo (escopo geral), daí `grupo_id` nullable — a mesma
-- decisão de `leads_comerciais`; `app_pode_ver_grupo(NULL)` só é verdade para
-- `escopo = 'geral'`.
-- ---------------------------------------------------------------------------
CREATE TABLE envios_de_mensagem (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id              uuid REFERENCES grupos(id),
  cliente_carteira_id   uuid,
  lead_comercial_id     uuid REFERENCES leads_comerciais(id),
  tarefa_interna_id     uuid REFERENCES tarefas_internas(id),
  destinatario          text NOT NULL CHECK (destinatario IN ('cliente', 'cobranca', 'parceiro', 'lead')),
  frente                text CHECK (frente IN ('financeiro', 'comercial', 'trafego', 'marketing')),
  origem                text NOT NULL CHECK (origem IN ('modelo', 'roteiro')),
  -- A chave do modelo, ou a chave/id do roteiro. Nunca o texto.
  chave                 text NOT NULL CHECK (length(chave) BETWEEN 1 AND 60),
  enviada_em            timestamptz NOT NULL DEFAULT now(),
  por_usuario_gestao_id uuid NOT NULL REFERENCES usuarios_gestao(id),
  chave_idempotencia    uuid NOT NULL,

  CONSTRAINT envios_de_mensagem_um_destino
    CHECK (num_nonnulls(cliente_carteira_id, lead_comercial_id) = 1),
  CONSTRAINT envios_de_mensagem_lead_por_roteiro
    CHECK ((lead_comercial_id IS NOT NULL) = (origem = 'roteiro' AND destinatario = 'lead')),
  CONSTRAINT envios_de_mensagem_parceiro_tem_frente
    CHECK ((destinatario = 'parceiro') = (frente IS NOT NULL)),
  -- O grupo do envio é o do cliente, sempre (A-8).
  CONSTRAINT envios_de_mensagem_cliente_do_grupo
    FOREIGN KEY (cliente_carteira_id, grupo_id)
    REFERENCES clientes_carteira (id, grupo_id)
    ON UPDATE CASCADE,
  CONSTRAINT envios_de_mensagem_cliente_tem_grupo
    CHECK (cliente_carteira_id IS NULL OR grupo_id IS NOT NULL)
);

COMMENT ON TABLE envios_de_mensagem IS
  'Fato de envio de mensagem pelo WhatsApp (G8 W2, LGPD A36): quem confirmou, '
  'quando, qual modelo/roteiro e o tipo de destinatário. SEM o texto. Nasce da '
  'confirmação da pessoa, nunca do clique que abre o WhatsApp (PP-6). Append-only.';

CREATE UNIQUE INDEX envios_de_mensagem_idempotencia
  ON envios_de_mensagem (por_usuario_gestao_id, chave_idempotencia);
CREATE INDEX envios_de_mensagem_por_cliente
  ON envios_de_mensagem (cliente_carteira_id, chave, enviada_em DESC) WHERE cliente_carteira_id IS NOT NULL;
CREATE INDEX envios_de_mensagem_por_lead
  ON envios_de_mensagem (lead_comercial_id, enviada_em DESC) WHERE lead_comercial_id IS NOT NULL;
CREATE INDEX envios_de_mensagem_por_tarefa
  ON envios_de_mensagem (tarefa_interna_id, enviada_em DESC) WHERE tarefa_interna_id IS NOT NULL;

ALTER TABLE envios_de_mensagem ENABLE ROW LEVEL SECURITY;
ALTER TABLE envios_de_mensagem FORCE  ROW LEVEL SECURITY;

CREATE POLICY envios_de_mensagem_por_grupo ON envios_de_mensagem
  TO fir_carteira
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

REVOKE ALL ON envios_de_mensagem FROM fir_app;
GRANT SELECT, INSERT ON envios_de_mensagem TO fir_carteira;

CREATE TRIGGER envios_de_mensagem_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON envios_de_mensagem
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria_do_painel();


-- ---------------------------------------------------------------------------
-- PARTE 5 — Oposição do parceiro ao contato (LGPD A37, art. 18 §2º). O lead
-- já tem (`0049`). O parceiro de uma frente é terceiro sem contrato com a
-- Firmare: o servidor recusa montar e registrar mensagem para quem se opôs.
-- O upsert do cadastro (`cadastro-do-cliente.ts`) não toca estas colunas,
-- então a marcação sobrevive à edição do parceiro.
-- ---------------------------------------------------------------------------
ALTER TABLE parceiros_do_cliente
  ADD COLUMN nao_contatar    boolean NOT NULL DEFAULT false,
  ADD COLUMN nao_contatar_em timestamptz,
  ADD CONSTRAINT parceiros_nao_contatar_tem_data
    CHECK (NOT nao_contatar OR nao_contatar_em IS NOT NULL);

COMMENT ON COLUMN parceiros_do_cliente.nao_contatar IS
  'Oposição ao contato (LGPD A37). Respeitada no servidor: mensagem pronta e '
  'registro de envio para este parceiro são recusados.';

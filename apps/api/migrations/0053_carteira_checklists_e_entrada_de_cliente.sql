-- ===========================================================================
-- G8, TICKET 2C — CHECKLISTS DOS PROGRAMAS E ENTRADA DE CLIENTE.
--
-- Inventário `docs/specs/g8-paridade-gestao-inventario.md` (X3, X5, V3, V15,
-- C4, C6). Protótipo `versoes/firmare-gestao-prototipo/index.html`:
-- `modelosPadrao` L566–622, `quemExecuta` L918–923, `checklistDe` L924–931,
-- `cChecklist` L2620–2632, `clienteExistente` L1735–1746, edição de item com
-- propagação L2881–2884. Gates: appsec A-8, A-19, A-20, A-21; LGPD A50 e A51
-- (VETOS sobre o texto da semente).
--
-- Forward-only, EXPAND: quatro tabelas novas, um índice único novo em
-- `tarefas_internas` e a semente. Nenhuma migration aplicada é editada.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- PARTE 1 — `modelos_de_checklist` e `itens_de_modelo`: o checklist de cada
-- programa (produto), ou de produto e frente ("Acelerador FIR · Comercial"),
-- que tem precedência sobre o geral do produto (`chaveModelo`, L564).
--
-- Tabelas GLOBAIS da Firmare (appsec A-19): sem `clinica_id` e sem
-- `grupo_id`. Leitura liberada para toda sessão da carteira — o `Usuário de
-- Gestão` de grupo cria cliente (C4) e precisa ler o modelo para aplicá-lo.
-- Escrita só por `escopo = 'geral'`; a chave `carteira.administrar` (0.5) entra
-- por AND quando existir — mesmo ponto de extensão de `materiais_da_biblioteca`.
--
-- Excluir item é ARQUIVAR (regra 20): a tarefa já gerada continua apontando
-- para ele, e a trilha de quem mudou o quê fica no trigger.
-- ---------------------------------------------------------------------------
CREATE TABLE modelos_de_checklist (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- O produto é texto (a lista `PRODUTOS_FIRMARE` é cobrada no contrato, como
  -- em `clientes_carteira.produto`).
  produto      text NOT NULL CHECK (length(btrim(produto)) BETWEEN 1 AND 80),
  -- NULL = o checklist geral do produto.
  area_foco    text CHECK (area_foco IN ('Comercial', 'Financeiro', 'Pessoas', 'Processos', 'Estratégia', 'Gestão')),
  -- NULL = semente desta migration.
  criado_por   uuid REFERENCES usuarios_gestao(id),
  criado_em    timestamptz NOT NULL DEFAULT now(),
  arquivado_em timestamptz
);

COMMENT ON TABLE modelos_de_checklist IS
  'Checklist do programa (G8 X3): o passo a passo de um produto, ou de produto '
  'e frente, que vira Tarefas internas quando um contrato é cadastrado. Global '
  'da Firmare (appsec A-19). Mudanças valem para os próximos clientes; o título '
  'editado propaga para as tarefas ainda abertas.';

-- Um checklist vivo por (produto, frente). `coalesce` porque NULL não repete
-- em índice único — sem ele, dois "geral do produto" passariam.
CREATE UNIQUE INDEX modelos_de_checklist_um_por_chave
  ON modelos_de_checklist (produto, coalesce(area_foco, ''))
  WHERE arquivado_em IS NULL;

CREATE TABLE itens_de_modelo (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo_de_checklist_id uuid NOT NULL REFERENCES modelos_de_checklist(id),
  -- D+N: dias depois do início do contrato (`fItem`, L2785).
  dias                   int  NOT NULL CHECK (dias BETWEEN 0 AND 730),
  titulo                 text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 300),
  -- `QUEM` (L561). Decide só A QUEM vai a tarefa — nunca autorização (A-4).
  quem                   text NOT NULL DEFAULT 'responsavel'
    CHECK (quem IN ('responsavel', 'admin', 'comercial', 'administrativo', 'financeiro')),
  -- 'diagnostico' = o item abre o briefing (L2626).
  acao                   text CHECK (acao IN ('diagnostico')),
  -- Desempate estável entre itens do mesmo D+N: a ordem da semente/inserção.
  ordem                  int  NOT NULL DEFAULT 0,
  criado_em              timestamptz NOT NULL DEFAULT now(),
  atualizado_em          timestamptz,
  arquivado_em           timestamptz
);

COMMENT ON TABLE itens_de_modelo IS
  'Item do checklist (G8 X3): D+N, título, quem executa e ação. Global da '
  'Firmare (appsec A-19). Arquivar nunca apaga a tarefa já gerada.';

CREATE INDEX itens_de_modelo_por_modelo ON itens_de_modelo (modelo_de_checklist_id) WHERE arquivado_em IS NULL;

ALTER TABLE modelos_de_checklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE modelos_de_checklist FORCE  ROW LEVEL SECURITY;
ALTER TABLE itens_de_modelo      ENABLE ROW LEVEL SECURITY;
ALTER TABLE itens_de_modelo      FORCE  ROW LEVEL SECURITY;

CREATE POLICY modelos_de_checklist_leitura ON modelos_de_checklist
  FOR SELECT TO fir_carteira USING (true);
CREATE POLICY modelos_de_checklist_criacao ON modelos_de_checklist
  FOR INSERT TO fir_carteira WITH CHECK (app_escopo() = 'geral');
CREATE POLICY modelos_de_checklist_edicao ON modelos_de_checklist
  FOR UPDATE TO fir_carteira USING (app_escopo() = 'geral') WITH CHECK (app_escopo() = 'geral');

CREATE POLICY itens_de_modelo_leitura ON itens_de_modelo
  FOR SELECT TO fir_carteira USING (true);
CREATE POLICY itens_de_modelo_criacao ON itens_de_modelo
  FOR INSERT TO fir_carteira WITH CHECK (app_escopo() = 'geral');
CREATE POLICY itens_de_modelo_edicao ON itens_de_modelo
  FOR UPDATE TO fir_carteira USING (app_escopo() = 'geral') WITH CHECK (app_escopo() = 'geral');

REVOKE ALL ON modelos_de_checklist FROM fir_app;
REVOKE ALL ON itens_de_modelo      FROM fir_app;
GRANT SELECT, INSERT, UPDATE ON modelos_de_checklist TO fir_carteira;
GRANT SELECT, INSERT, UPDATE ON itens_de_modelo      TO fir_carteira;

CREATE TRIGGER modelos_de_checklist_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON modelos_de_checklist
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria_do_painel();
CREATE TRIGGER itens_de_modelo_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON itens_de_modelo
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria_do_painel();


-- ---------------------------------------------------------------------------
-- PARTE 2 — `checklist_do_cliente`: cada item aplicado a um cliente e a
-- `Tarefa interna` que ele gerou (X5, V15).
--
-- IDEMPOTÊNCIA (A-20): `UNIQUE (cliente_carteira_id, item_de_modelo_id)` — o
-- mesmo item nunca vira duas tarefas para o mesmo cliente, por mais que o
-- "aplicar" se repita (duplo clique, retry, "Novo cliente" reenviado). O
-- serviço insere com `ON CONFLICT DO NOTHING` e só cria a tarefa quando a
-- linha acabou de nascer — o mesmo desenho de `encaminhamentos_de_reuniao`.
--
-- O STATUS mora na tarefa: "Marcar aqui ou na rotina conclui nos dois"
-- (L2631) é verdade por construção, porque só existe um status.
--
-- A-8: FK composta para o cliente E para a tarefa — o grupo do item não
-- diverge de nenhum dos dois.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS tarefas_internas_id_grupo_unico_2c ON tarefas_internas (id, grupo_id);

CREATE TABLE checklist_do_cliente (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_carteira_id    uuid NOT NULL,
  grupo_id               uuid NOT NULL REFERENCES grupos(id),
  modelo_de_checklist_id uuid NOT NULL REFERENCES modelos_de_checklist(id),
  item_de_modelo_id      uuid NOT NULL REFERENCES itens_de_modelo(id),
  -- Cópias do item NO MOMENTO da aplicação: o D+N e a ação mostrados na ficha
  -- não mudam quando o modelo muda ("Mudanças valem para os próximos").
  dias                   int  NOT NULL CHECK (dias BETWEEN 0 AND 730),
  acao                   text CHECK (acao IN ('diagnostico')),
  ordem                  int  NOT NULL DEFAULT 0,
  tarefa_interna_id      uuid UNIQUE,
  -- O item entrou já feito porque o prazo passou antes da entrada da cliente
  -- que já era da Firmare (C6, L1739–1740).
  entrou_feito           boolean NOT NULL DEFAULT false,
  criado_em              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT checklist_do_cliente_cliente_do_grupo
    FOREIGN KEY (cliente_carteira_id, grupo_id) REFERENCES clientes_carteira (id, grupo_id)
    ON UPDATE CASCADE,
  CONSTRAINT checklist_do_cliente_tarefa_do_grupo
    FOREIGN KEY (tarefa_interna_id, grupo_id) REFERENCES tarefas_internas (id, grupo_id)
    ON UPDATE CASCADE,
  CONSTRAINT checklist_do_cliente_um_por_item UNIQUE (cliente_carteira_id, item_de_modelo_id)
);

COMMENT ON TABLE checklist_do_cliente IS
  'Checklist do contrato (G8 X5/V15): um item do checklist do programa aplicado '
  'a um Cliente Firmare, e a Tarefa interna que ele gerou. UNIQUE (cliente, '
  'item): aplicar de novo nunca cria tarefa em dobro (appsec A-20).';

CREATE INDEX checklist_do_cliente_por_cliente ON checklist_do_cliente (cliente_carteira_id);
CREATE INDEX checklist_do_cliente_por_item ON checklist_do_cliente (item_de_modelo_id);

ALTER TABLE checklist_do_cliente ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_do_cliente FORCE  ROW LEVEL SECURITY;

CREATE POLICY checklist_do_cliente_por_grupo ON checklist_do_cliente
  TO fir_carteira
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

REVOKE ALL ON checklist_do_cliente FROM fir_app;
GRANT SELECT, INSERT, UPDATE ON checklist_do_cliente TO fir_carteira;

CREATE TRIGGER checklist_do_cliente_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON checklist_do_cliente
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria_do_painel();


-- ---------------------------------------------------------------------------
-- PARTE 3 — `entradas_de_cliente_existente`: a cliente que JÁ ERA da Firmare
-- trazida para a ferramenta (C6, `clienteExistente` L1735; `avisoMigracao`
-- L1723). Uma linha por cliente.
--
--  * `tarefa_completar_cadastro_id`: "Completar o cadastro de X" (L1743),
--    criada uma vez — o UNIQUE por cliente é a idempotência.
--  * `tarefa_cadastrar_metas_id`: "Cadastrar as metas em andamento de X"
--    (`migMetasDepois`, L2906), criada uma vez.
--  * `metas_chave`: a chave do lote de "Metas em andamento" (passo 2 de 3).
--    Reenviar o mesmo lote devolve o resultado, sem meta em dobro (A-20).
--  * `asana_dispensado_em`: "Não há reuniões para importar" (L1727).
-- ---------------------------------------------------------------------------
CREATE TABLE entradas_de_cliente_existente (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_carteira_id          uuid NOT NULL UNIQUE,
  grupo_id                     uuid NOT NULL REFERENCES grupos(id),
  tarefa_completar_cadastro_id uuid UNIQUE,
  tarefa_cadastrar_metas_id    uuid UNIQUE,
  metas_chave                  uuid UNIQUE,
  metas_quantidade             int CHECK (metas_quantidade IS NULL OR metas_quantidade BETWEEN 1 AND 30),
  asana_dispensado_em          timestamptz,
  por_usuario_gestao_id        uuid NOT NULL REFERENCES usuarios_gestao(id),
  criado_em                    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT entradas_de_cliente_existente_cliente_do_grupo
    FOREIGN KEY (cliente_carteira_id, grupo_id) REFERENCES clientes_carteira (id, grupo_id)
    ON UPDATE CASCADE,
  CONSTRAINT entradas_de_cliente_existente_cadastro_do_grupo
    FOREIGN KEY (tarefa_completar_cadastro_id, grupo_id) REFERENCES tarefas_internas (id, grupo_id)
    ON UPDATE CASCADE,
  CONSTRAINT entradas_de_cliente_existente_metas_do_grupo
    FOREIGN KEY (tarefa_cadastrar_metas_id, grupo_id) REFERENCES tarefas_internas (id, grupo_id)
    ON UPDATE CASCADE,
  CONSTRAINT entradas_de_cliente_existente_lote_inteiro
    CHECK ((metas_chave IS NULL) = (metas_quantidade IS NULL))
);

COMMENT ON TABLE entradas_de_cliente_existente IS
  'Entrada de cliente que já é da Firmare (G8 C6): o registro de que a cliente '
  'foi trazida para a ferramenta, as duas tarefas da entrada e o lote de metas '
  'em andamento. Uma linha por cliente; cada coluna de tarefa/lote é a chave de '
  'idempotência do passo (appsec A-20).';

ALTER TABLE entradas_de_cliente_existente ENABLE ROW LEVEL SECURITY;
ALTER TABLE entradas_de_cliente_existente FORCE  ROW LEVEL SECURITY;

CREATE POLICY entradas_de_cliente_existente_por_grupo ON entradas_de_cliente_existente
  TO fir_carteira
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

REVOKE ALL ON entradas_de_cliente_existente FROM fir_app;
GRANT SELECT, INSERT, UPDATE ON entradas_de_cliente_existente TO fir_carteira;

CREATE TRIGGER entradas_de_cliente_existente_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON entradas_de_cliente_existente
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria_do_painel();


-- ---------------------------------------------------------------------------
-- PARTE 4 — A SEMENTE: os seis checklists de `modelosPadrao` (L566–622), na
-- ordem e com o texto do protótipo, MENOS os dois itens VETADOS pelo gate
-- LGPD:
--
--  * A50 — o D+2 do "Acelerador FIR · Comercial" (L578) mandava pedir à
--    cliente "exportação da base de pacientes". A ferramenta não instrui a
--    Firmare a receber base de paciente (art. 11; operadora fora de contrato).
--    Trocado pelo texto que o gate recomenda: relatório AGREGADO por serviço,
--    sem identificação de paciente.
--  * A51 — o D+3 (L579) mandava "anexar a transcrição" do briefing, sem lugar
--    para guardá-la no sistema. Trocado por "Realizar o briefing com o roteiro
--    da ferramenta".
--
-- `teste/checklists-carteira-no-banco.test.ts` varre as linhas gravadas e
-- reprova se qualquer item mencionar base de pacientes ou transcrição.
-- ---------------------------------------------------------------------------
-- A trilha (`registrar_auditoria_do_painel`) recusa escrita sem ator.
SELECT set_config('app.pessoa_id', 'sistema', true);

CREATE TEMP TABLE semente_2c (produto text, area_foco text, ordem int, dias int, titulo text, quem text, acao text)
  ON COMMIT DROP;

INSERT INTO semente_2c (produto, area_foco, ordem, dias, titulo, quem, acao) VALUES
  ('Acelerador FIR', NULL, 1, 0, 'Conferir contrato assinado e primeira mensalidade', 'admin', NULL),
  ('Acelerador FIR', NULL, 2, 1, 'Criar grupo de WhatsApp com a cliente', 'responsavel', NULL),
  ('Acelerador FIR', NULL, 3, 1, 'Enviar mensagem de boas vindas', 'responsavel', NULL),
  ('Acelerador FIR', NULL, 4, 2, 'Agendar diagnóstico online', 'responsavel', NULL),
  ('Acelerador FIR', NULL, 5, 7, 'Realizar diagnóstico e definir área de foco', 'admin', NULL),
  ('Acelerador FIR', NULL, 6, 7, 'Fixar dia e horário da reunião semanal', 'responsavel', NULL),
  ('Acelerador FIR', NULL, 7, 10, 'Entregar plano de ação de 4 meses', 'admin', NULL),
  ('Acelerador FIR', NULL, 8, 10, 'Liberar repositório de documentos', 'responsavel', NULL),
  ('Acelerador FIR', NULL, 9, 14, 'Montar dashboard com os indicadores da área', 'responsavel', NULL),
  ('Acelerador FIR', NULL, 10, 14, 'Enviar materiais de apoio da área de foco', 'responsavel', NULL),
  ('Acelerador FIR', NULL, 11, 60, 'Revisão de meio de ciclo', 'admin', NULL),
  ('Acelerador FIR', NULL, 12, 110, 'Reunião de encerramento e proposta de renovação', 'admin', NULL),

  ('Gestão por Assinatura', NULL, 1, 0, 'Conferir contrato assinado', 'admin', NULL),
  ('Gestão por Assinatura', NULL, 2, 1, 'Criar grupo de WhatsApp com a cliente', 'responsavel', NULL),
  ('Gestão por Assinatura', NULL, 3, 3, 'Reunião de alinhamento inicial', 'admin', NULL),
  ('Gestão por Assinatura', NULL, 4, 7, 'Definir indicadores acompanhados', 'responsavel', NULL),
  ('Gestão por Assinatura', NULL, 5, 7, 'Fixar agenda mensal de reuniões', 'responsavel', NULL),
  ('Gestão por Assinatura', NULL, 6, 10, 'Liberar portal de documentos', 'responsavel', NULL),
  ('Gestão por Assinatura', NULL, 7, 30, 'Enviar primeiro relatório mensal', 'responsavel', NULL),

  ('Consultoria', NULL, 1, 0, 'Conferir contrato assinado', 'admin', NULL),
  ('Consultoria', NULL, 2, 1, 'Criar grupo de WhatsApp com a cliente', 'responsavel', NULL),
  ('Consultoria', NULL, 3, 3, 'Reunião de abertura', 'admin', NULL),
  ('Consultoria', NULL, 4, 10, 'Levantamento de informações e documentos', 'responsavel', NULL),
  ('Consultoria', NULL, 5, 20, 'Apresentar diagnóstico', 'admin', NULL),
  ('Consultoria', NULL, 6, 25, 'Entregar plano de ação', 'responsavel', NULL),
  ('Consultoria', NULL, 7, 60, 'Relatório de acompanhamento', 'responsavel', NULL),

  ('Acelerador FIR', 'Comercial', 1, 0, 'Conferir contrato assinado e primeira mensalidade', 'administrativo', NULL),
  ('Acelerador FIR', 'Comercial', 2, 0, 'Completar o cadastro da cliente: pagamento, serviços, parceiros e links', 'administrativo', NULL),
  ('Acelerador FIR', 'Comercial', 3, 1, 'Criar o grupo de WhatsApp com a dona e quem executa', 'administrativo', NULL),
  ('Acelerador FIR', 'Comercial', 4, 1, 'Enviar a mensagem de boas vindas explicando o primeiro mês', 'comercial', NULL),
  ('Acelerador FIR', 'Comercial', 5, 1, 'Agendar o briefing de 2 a 3 horas', 'comercial', NULL),
  -- A50 (VETO): texto substituído — nenhuma base nominal de paciente.
  ('Acelerador FIR', 'Comercial', 6, 2, 'Solicitar à cliente: tabela de preços e relatório de faturamento dos últimos 6 meses agregado por serviço, sem identificação de paciente', 'comercial', NULL),
  -- A51 (VETO): sem "anexar a transcrição" enquanto a Etapa 2 não existir.
  ('Acelerador FIR', 'Comercial', 7, 3, 'Realizar o briefing com o roteiro da ferramenta', 'admin', 'diagnostico'),
  ('Acelerador FIR', 'Comercial', 8, 4, 'Conferir as pendências do briefing, os parceiros e o dia da reunião', 'comercial', 'diagnostico'),
  ('Acelerador FIR', 'Comercial', 9, 4, 'Criar a pasta da cliente, o painel do cliente e a planilha de indicadores', 'administrativo', NULL),
  ('Acelerador FIR', 'Comercial', 10, 5, 'Configurar a Gestão de Rotina da clínica (equipe, tipos de contato, campanhas)', 'administrativo', NULL),
  ('Acelerador FIR', 'Comercial', 11, 5, 'Cadastrar os parceiros e enviar o primeiro formulário semanal', 'administrativo', NULL),
  ('Acelerador FIR', 'Comercial', 12, 7, 'Estudo de carteira: base ativa, inativos, ticket, frequência e serviços que mais faturam', 'comercial', NULL),
  ('Acelerador FIR', 'Comercial', 13, 8, 'Desenhar a esteira de serviços: porta de entrada, serviços principais e recorrência', 'comercial', NULL),
  ('Acelerador FIR', 'Comercial', 14, 10, 'Montar o plano de ação de 4 meses com prioridades, responsáveis e prazos', 'admin', NULL),
  ('Acelerador FIR', 'Comercial', 15, 10, 'Definir as metas mensais do ciclo e os indicadores comerciais', 'comercial', NULL),
  ('Acelerador FIR', 'Comercial', 16, 12, 'Apresentar o plano e as metas para a clínica', 'admin', NULL),
  ('Acelerador FIR', 'Comercial', 17, 12, 'Confirmar o dia fixo da reunião semanal de metas', 'comercial', NULL),
  ('Acelerador FIR', 'Comercial', 18, 14, 'Treinar a recepção: roteiro de atendimento no WhatsApp e apresentação de orçamento', 'comercial', NULL),
  ('Acelerador FIR', 'Comercial', 19, 14, 'Implantar a rotina de follow up de orçamentos na Gestão de Rotina', 'comercial', NULL),
  ('Acelerador FIR', 'Comercial', 20, 17, 'Montar o calendário de campanhas do trimestre (ativação, reativação, aniversariantes, indicação)', 'comercial', NULL),
  ('Acelerador FIR', 'Comercial', 21, 21, 'Lançar a primeira campanha: reativação de pacientes inativos', 'comercial', NULL),
  ('Acelerador FIR', 'Comercial', 22, 21, 'Publicar o dash de indicadores comerciais e enviar os acessos para a cliente', 'administrativo', NULL),
  ('Acelerador FIR', 'Comercial', 23, 28, 'Primeira leitura de resultados: conversão, campanhas e metas', 'comercial', NULL),
  ('Acelerador FIR', 'Comercial', 24, 30, 'Checkpoint do primeiro mês com a diretoria: onboarding concluído', 'admin', NULL),
  ('Acelerador FIR', 'Comercial', 25, 60, 'Revisão de meio de ciclo', 'admin', NULL),
  ('Acelerador FIR', 'Comercial', 26, 90, 'Planejamento comercial do trimestre seguinte', 'comercial', NULL),
  ('Acelerador FIR', 'Comercial', 27, 110, 'Encerramento do ciclo e proposta de continuidade', 'admin', NULL),

  ('Programa de Gestão FIR', NULL, 1, 0, 'Conferir o contrato e os acessos combinados', 'administrativo', NULL),
  ('Programa de Gestão FIR', NULL, 2, 1, 'Criar o grupo de WhatsApp com quem lidera e a gestora', 'administrativo', NULL),
  ('Programa de Gestão FIR', NULL, 3, 1, 'Agendar o briefing de gestão', 'comercial', NULL),
  ('Programa de Gestão FIR', NULL, 4, 3, 'Realizar o briefing e apresentar o Mapa de Maturidade', 'admin', 'diagnostico'),
  ('Programa de Gestão FIR', NULL, 5, 4, 'Configurar a FIR Clinic da clínica: equipe, perfis e tipos de contato', 'administrativo', NULL),
  ('Programa de Gestão FIR', NULL, 6, 5, 'Definir a meta do mês e os três indicadores que guiam as decisões', 'comercial', NULL),
  ('Programa de Gestão FIR', NULL, 7, 7, 'Desenhar os rituais: reunião semanal de resultados, alinhamento diário e fechamento mensal', 'admin', NULL),
  ('Programa de Gestão FIR', NULL, 8, 8, 'Cadastrar as rotinas recorrentes da equipe na FIR Clinic', 'administrativo', NULL),
  ('Programa de Gestão FIR', NULL, 9, 10, 'Treinar a equipe na FIR Clinic', 'comercial', NULL),
  ('Programa de Gestão FIR', NULL, 10, 12, 'Mapa de responsabilidades: quem faz o quê e o que cada pessoa decide', 'admin', NULL),
  ('Programa de Gestão FIR', NULL, 11, 14, 'Conduzir a primeira reunião semanal de resultados com a equipe', 'admin', NULL),
  ('Programa de Gestão FIR', NULL, 12, 17, 'Implantar o follow up de orçamentos e o pós consulta na FIR Clinic', 'comercial', NULL),
  ('Programa de Gestão FIR', NULL, 13, 19, 'Primeira leitura de uso da ferramenta: quem usa e tarefas no prazo', 'administrativo', NULL),
  ('Programa de Gestão FIR', NULL, 14, 21, 'Segunda reunião de resultados conduzida pela gestora, com apoio da Firmare', 'comercial', NULL),
  ('Programa de Gestão FIR', NULL, 15, 24, 'Consolidar os indicadores do mês', 'financeiro', NULL),
  ('Programa de Gestão FIR', NULL, 16, 26, 'Reaplicar o Mapa de Maturidade', 'admin', 'diagnostico'),
  ('Programa de Gestão FIR', NULL, 17, 28, 'Reunião de encerramento: evolução do mapa e plano dos 90 dias de uso', 'admin', NULL),
  ('Programa de Gestão FIR', NULL, 18, 45, 'Checkpoint de uso da FIR Clinic', 'comercial', NULL),
  ('Programa de Gestão FIR', NULL, 19, 75, 'Checkpoint de uso e resultados', 'comercial', NULL),
  ('Programa de Gestão FIR', NULL, 20, 88, 'Conversa de continuidade: fim do período de uso gratuito', 'admin', NULL),

  ('Projeto', NULL, 1, 0, 'Conferir contrato assinado e sinal', 'admin', NULL),
  ('Projeto', NULL, 2, 1, 'Criar grupo de WhatsApp do projeto', 'responsavel', NULL),
  ('Projeto', NULL, 3, 2, 'Reunião de abertura e validação do escopo', 'admin', NULL),
  ('Projeto', NULL, 4, 4, 'Enviar cronograma de entregas', 'responsavel', NULL),
  ('Projeto', NULL, 5, 5, 'Solicitar materiais e acessos da cliente', 'responsavel', NULL),
  ('Projeto', NULL, 6, 15, 'Primeira entrega para validação', 'responsavel', NULL),
  ('Projeto', NULL, 7, 25, 'Ajustes da validação', 'responsavel', NULL),
  ('Projeto', NULL, 8, 30, 'Entrega final e aceite formal', 'admin', NULL),
  ('Projeto', NULL, 9, 32, 'Pedir depoimento da cliente', 'responsavel', NULL),
  ('Projeto', NULL, 10, 35, 'Oferecer continuidade em outro produto', 'admin', NULL);

INSERT INTO modelos_de_checklist (produto, area_foco)
SELECT DISTINCT produto, area_foco FROM semente_2c;

INSERT INTO itens_de_modelo (modelo_de_checklist_id, dias, titulo, quem, acao, ordem)
SELECT m.id, s.dias, s.titulo, s.quem, s.acao, s.ordem
  FROM semente_2c s
  JOIN modelos_de_checklist m
    ON m.produto = s.produto AND m.area_foco IS NOT DISTINCT FROM s.area_foco;

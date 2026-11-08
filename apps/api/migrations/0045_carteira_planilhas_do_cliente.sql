-- ===========================================================================
-- G8, ONDA 4 — ticket 4A: a planilha de indicadores do Cliente Firmare.
-- Inventário `docs/specs/g8-paridade-gestao-inventario.md` (G1-G4, V11, P7,
-- M5, W3); gate de segurança `g8-gate-appsec.md` A-16; D-22 item 7 (conta
-- de serviço do Google).
--
-- Uma linha por cliente: o id da planilha, o link que a pessoa colou e o
-- último resultado da leitura. Tabela PRÓPRIA, e não `clientes_carteira.
-- link_planilha`: o cadastro completo do cliente (ticket 0.4) está em
-- construção em paralelo, e a leitura precisa de estado próprio (quando leu,
-- o que leu, o erro) que não pertence ao cadastro.
--
-- Forward-only, expand: tabela nova e um índice único em `clientes_carteira`
-- que só existe para a chave estrangeira composta abaixo.
-- ===========================================================================

-- A chave estrangeira composta `(cliente_carteira_id, grupo_id)` exige um
-- UNIQUE sobre o par no lado referenciado. `id` já é chave primária, então o
-- par é único por construção — o índice não restringe nada novo, só dá ao
-- Postgres o alvo que ele pede.
CREATE UNIQUE INDEX IF NOT EXISTS clientes_carteira_id_grupo ON clientes_carteira (id, grupo_id);

CREATE TABLE planilhas_do_cliente (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Um cliente, uma planilha.
  cliente_carteira_id uuid NOT NULL UNIQUE,
  grupo_id            uuid NOT NULL REFERENCES grupos(id),
  -- O id extraído do link (`idDaPlanilha`, domínio). É SÓ ele que o worker
  -- usa: a URL colada nunca é buscada (A-16, sem SSRF).
  spreadsheet_id      text NOT NULL CHECK (spreadsheet_id ~ '^[A-Za-z0-9_-]{20,100}$'),
  link                text NOT NULL CHECK (
                        length(link) <= 2000
                        AND link LIKE 'https://docs.google.com/spreadsheets/%'
                      ),
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  -- "Ler planilha agora": quando foi pedido. Limite por cliente (A-16).
  leitura_pedida_em   timestamptz,
  lida_em             timestamptz,
  -- `PlanilhaInterpretada` (domínio): carimbos, semanas, quantas perguntas
  -- respondidas e os NÚMEROS (centavos e contagens). NUNCA texto livre
  -- (análise do parceiro, dados de campanha) nem colunas fora da
  -- especificação (e-mail do respondente): só as perguntas da especificação
  -- são lidas, e as de texto guardam apenas "respondida".
  resultado           jsonb,
  -- Frase para a tela, de um conjunto fechado escrito pelo adaptador. Nunca
  -- o corpo da resposta do Google, nunca credencial.
  erro                text CHECK (erro IS NULL OR length(erro) <= 300),

  -- O grupo da planilha é SEMPRE o do cliente. Sem isto, um `Usuário de
  -- Gestão` de escopo geral poderia gravar a planilha do cliente de A com o
  -- `grupo_id` de B, e o grupo B passaria a ver os números de A.
  -- `ON UPDATE CASCADE`: mudar o cliente de grupo leva a planilha junto.
  CONSTRAINT planilhas_do_cliente_cliente_e_grupo
    FOREIGN KEY (cliente_carteira_id, grupo_id)
    REFERENCES clientes_carteira (id, grupo_id) ON UPDATE CASCADE
);

-- **O DEPUTADO CONFUSO (A-16).** A conta de serviço lê TODA planilha
-- compartilhada com ela. Se o mesmo id pudesse estar em dois clientes, quem
-- colasse no próprio cliente o id da planilha de outro passaria a ver os
-- números do outro. Único GLOBAL — entre grupos, de propósito: o índice não
-- está sujeito à RLS, e é exatamente por isso que ele protege.
CREATE UNIQUE INDEX planilhas_do_cliente_spreadsheet_unico ON planilhas_do_cliente (spreadsheet_id);

COMMENT ON TABLE planilhas_do_cliente IS
  'A planilha de indicadores de um Cliente Firmare (ticket 4A): o id da '
  'planilha Google, o link colado e o último resultado da leitura pela conta '
  'de serviço. Um id só pode estar em UM cliente (deputado confuso, A-16). '
  'O resultado guarda só números e carimbos — nunca texto livre.';

ALTER TABLE planilhas_do_cliente ENABLE ROW LEVEL SECURITY;
ALTER TABLE planilhas_do_cliente FORCE  ROW LEVEL SECURITY;
-- `TO fir_carteira` explícito: policy sem `TO` vale `PUBLIC` e se soma por
-- OR a qualquer outra (a lição da 0035). O portal não lê esta tabela.
CREATE POLICY planilhas_do_cliente_por_grupo ON planilhas_do_cliente
  TO fir_carteira
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

REVOKE ALL ON planilhas_do_cliente FROM PUBLIC;
REVOKE ALL ON planilhas_do_cliente FROM fir_app;
-- Sem DELETE: trocar de planilha é UPDATE (e a trilha guarda o de→para).
GRANT SELECT, INSERT, UPDATE ON planilhas_do_cliente TO fir_carteira;

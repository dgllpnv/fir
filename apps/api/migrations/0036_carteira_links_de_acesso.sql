-- ---------------------------------------------------------------------------
-- OS 4 LINKS DE ACESSO do `Cliente Firmare` — achado real do
-- revisor-codigo/engenheiro-backend: o spec do Portal do Grupo (G6,
-- docs/superpowers/plans/g6-spec-portal-do-grupo.md §3.1 item 7, §6 critério
-- 7) descreve os 4 links como núcleo obrigatório, preservados do protótipo
-- original (`fg-portal.js:116-117`) — e eles nunca foram construídos. Esta
-- migration fecha só a lacuna de dado; contrato, backend de escrita/leitura
-- e tela entram no mesmo commit, fora desta migration.
--
-- NOMES DAS COLUNAS: copiados LITERALMENTE das chaves usadas pelo protótipo
-- (`fg-portal.js:116`, array `LK`) — `link_painel`, `link_dash_ind`,
-- `link_dash_fin`, `link_rotina` — em vez de expandir "ind"/"fin" por
-- extenso. A documentação funcional de cada um (mesma linha do protótipo):
--   link_painel   -> "Painel da clínica"  (o FIR Clinic / painel operacional)
--   link_dash_ind -> "Indicadores"        (dashboard de indicadores)
--   link_dash_fin -> "Financeiro"         (dashboard financeiro)
--   link_rotina   -> "FIR Clinic"         (a rotina de gestão da equipe —
--                     nome mantido como no protótipo; é a URL deste próprio
--                     produto, aberta em nova aba, não uma rota interna)
-- Preservar o nome exato da origem evita uma segunda tradução divergente
-- entre banco, contrato e protótipo quando alguém for comparar os dois no
-- futuro (CLAUDE.md: "o protótipo é o desempate").
--
-- NULLABLE, sem default: a Firmare cadastra cada link quando existir — nem
-- todo `Cliente Firmare` tem os 4 desde o primeiro dia. `text`, não
-- `varchar(n)`: são URLs completas, de tamanho variável, e a validação de
-- forma (precisa ser uma URL) é do contrato de ENTRADA
-- (`packages/contracts/src/carteira.ts`), nunca um CHECK de banco — mesma
-- divisão de responsabilidade das demais colunas desta tabela.
--
-- SEM RLS NOVA: `clientes_carteira` já tem a policy por `grupo_id`
-- (0026) e a policy de leitura do portal (`clientes_carteira_portal`, 0034) —
-- ambas cobrem a tabela inteira (`SELECT *`/`UPDATE` por linha), então 4
-- colunas a mais não pedem nenhuma policy nova (EXPAND puro).
-- ---------------------------------------------------------------------------

ALTER TABLE clientes_carteira
  ADD COLUMN link_painel   text,
  ADD COLUMN link_dash_ind text,
  ADD COLUMN link_dash_fin text,
  ADD COLUMN link_rotina   text;

COMMENT ON COLUMN clientes_carteira.link_painel IS
  'URL externa do painel/FIR Clinic da clínica, cadastrada pela Firmare e '
  'aberta pelo Portal do Grupo em nova aba — string crua, nunca processada, '
  'encurtada ou proxyada (spec G6 §3.1 item 7, fg-portal.js:116-117).';

COMMENT ON COLUMN clientes_carteira.link_dash_ind IS
  'URL externa do dashboard de indicadores. Mesma regra de link_painel.';

COMMENT ON COLUMN clientes_carteira.link_dash_fin IS
  'URL externa do dashboard financeiro. Mesma regra de link_painel.';

COMMENT ON COLUMN clientes_carteira.link_rotina IS
  'URL externa da rotina de gestão (este próprio produto, por cliente). '
  'Mesma regra de link_painel.';

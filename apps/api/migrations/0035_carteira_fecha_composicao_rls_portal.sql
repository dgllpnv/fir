-- ---------------------------------------------------------------------------
-- FECHA A COMPOSIÇÃO DE RLS ENTRE `fir_carteira` E `fir_portal`. ADR 0018
-- (isolamento), regra 19 do CLAUDE.md.
--
-- O ACHADO (revisor-codigo, reproduzido ao vivo contra o Postgres local):
-- as policies PRÉ-EXISTENTES das nove tabelas comerciais abaixo foram
-- criadas (0026, 0028, 0031, 0034) SEM cláusula `TO` — o que no Postgres
-- significa `TO PUBLIC`, aplicável a QUALQUER role, inclusive `fir_portal`.
-- A migration 0034 (G6) somou, nas MESMAS tabelas, uma segunda policy
-- PERMISSIVA restrita `TO fir_portal` (`app_portal_pode_ver`).
--
-- Múltiplas policies PERMISSIVAS que se aplicam ao mesmo role, para o mesmo
-- comando, são combinadas com OR pelo motor de RLS do Postgres — isto NÃO é
-- opcional, é como `CREATE POLICY` sem `AS RESTRICTIVE` sempre funcionou.
-- Logo, para `fir_portal`, a cláusula efetiva de cada uma destas nove
-- tabelas sempre foi
--   app_pode_ver_grupo(grupo_id) OR app_portal_pode_ver(grupo_id, ...)
-- e `app_pode_ver_grupo` retorna `true` para QUALQUER grupo quando
-- `app.escopo = 'geral'` — um valor que o portal nunca fixa, mas que
-- ninguém jamais o impediu de fixar, e que basta estar presente na conexão
-- (de um bug noutra rota, de um pool reaproveitado, de um teste) para abrir
-- a tabela inteira.
--
-- Reproduzido ao vivo ANTES desta migration: conectado como `fir_portal`,
-- fixando SÓ `app.escopo = 'geral'` (sem tocar `app.portal_grupo_id`/
-- `app.portal_cliente_id`), `SELECT count(*) FROM clientes_carteira`
-- devolveu as 26 linhas de TODOS os grupos. Depois desta migration a mesma
-- consulta devolve 0 — ver `teste/portal-no-banco.test.ts`.
--
-- A CORREÇÃO: `ALTER POLICY ... TO fir_carteira` em cada uma das nove
-- policies pré-existentes, restringindo explicitamente quem é sujeito a
-- elas. `fir_carteira` é o único papel com GRANT de escrita nestas tabelas
-- (REVOKE ALL FROM fir_app já existe desde a criação de cada uma — 0026,
-- 0028, 0031, 0034) — conferido policy a policy contra `pg_policy`/
-- `information_schema.table_privileges` antes de escrever este arquivo, não
-- assumido. Depois do `TO`, `fir_portal` deixa de ser sujeito a QUALQUER
-- policy destas tabelas além da `_portal` dele — e a `_portal` exige
-- `app.portal_grupo_id`/`app.portal_cliente_id`, nunca satisfeitos por
-- `app.escopo`.
--
-- Migration FORWARD-ONLY (regra do CLAUDE.md): a 0026/0028/0031/0034 não são
-- editadas. `ALTER POLICY` é a forma EXPAND correta para mudar quem uma
-- policy já aplicada alcança, sem reescrever o passado.
-- ---------------------------------------------------------------------------

ALTER POLICY clientes_carteira_por_grupo                ON clientes_carteira                TO fir_carteira;
ALTER POLICY campanhas_carteira_por_grupo                ON campanhas_carteira                TO fir_carteira;
ALTER POLICY indicadores_carteira_por_grupo              ON indicadores_carteira              TO fir_carteira;
ALTER POLICY metas_comerciais_por_grupo                  ON metas_comerciais                  TO fir_carteira;
ALTER POLICY lancamentos_de_indicador_por_grupo          ON lancamentos_de_indicador          TO fir_carteira;
ALTER POLICY cobrancas_do_cliente_firmare_por_grupo      ON cobrancas_do_cliente_firmare      TO fir_carteira;
ALTER POLICY documentos_carteira_carteira                ON documentos_carteira               TO fir_carteira;
ALTER POLICY materiais_carteira_carteira                 ON materiais_carteira                TO fir_carteira;
ALTER POLICY reunioes_comerciais_carteira                ON reunioes_comerciais               TO fir_carteira;

-- ---------------------------------------------------------------------------
-- CORREÇÃO DE DOIS COMENTÁRIOS FALSOS, registrada aqui (nunca editando a
-- migration já aplicada onde cada um vive):
--
-- 1. `0034_carteira_portal.sql`, perto de `documentos_carteira_portal`, diz:
--    "Restrita A `fir_portal` (cláusula `TO`): não compõe por OR com a
--    policy acima para `fir_carteira` — cada papel só é sujeito à SUA
--    policy". Isso descreve a policy NOVA (`..._portal`, que de fato nasceu
--    com `TO fir_portal`) mas é FALSO sobre a policy ANTIGA ao lado dela
--    (`documentos_carteira_carteira`, `materiais_carteira_carteira`,
--    `reunioes_comerciais_carteira`, e as seis `..._por_grupo` de 0026/0028/
--    0031): nenhuma delas tinha `TO` até esta 0035, logo TODAS valiam
--    `PUBLIC`, e `fir_portal` ERA sujeito às duas — compondo por OR, não
--    "cada papel só a sua". O comentário teria sido verdade se a policy
--    antiga TAMBÉM tivesse `TO` desde o início; não tinha.
--
-- 2. `teste/isolamento-de-clinica.test.ts`, nos dois `it` que examinam
--    `ENTIDADES_COM_CLINICA_POR_GRUPO` e `ENTIDADES_DO_FINANCEIRO_DA_
--    CARTEIRA_SEM_CLINICA`, filtrava `r.rows.filter((p) =>
--    !p.roles.includes('fir_portal'))` para isolar "a policy de
--    fir_carteira" antes de cobrar `app_pode_ver_grupo`. O filtro em si
--    continua correto para esse propósito pontual — mas nenhum teste da
--    suíte NUNCA exerceu a composição real (conectar como `fir_portal` e
--    medir o que o Postgres de fato devolve quando só `app.escopo` está
--    fixado). O filtro media a FORMA da policy (o texto da cláusula), nunca
--    o COMPORTAMENTO composto — e é exatamente a lacuna que esta migration
--    fecha com `TO`, e que os testes novos em `teste/isolamento-de-
--    clinica.test.ts` e `teste/portal-no-banco.test.ts` passam a provar por
--    comportamento, não por leitura de texto.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- Policies para o papel de carga da migração do Supabase (`migracao_carteira`).
--
-- As policies da carteira são `TO fir_carteira`. Para a RLS valer para o papel de
-- carga SEM ele ser membro de `fir_carteira` (o que lhe daria UPDATE e o DELETE de
-- `parceiros_do_cliente`), cada tabela que a carga escreve ganha policies próprias
-- de SELECT e INSERT, `TO migracao_carteira` explícito (nunca PUBLIC: o invariante
-- de `isolamento-de-clinica.test.ts`). Nenhuma de UPDATE ou DELETE: com RLS forçada,
-- o banco recusa os dois para o papel mesmo que alguém lhe dê o GRANT.
--
-- O papel é criado FORA de migration (`fir_migrate` não tem CREATEROLE) e só existe
-- durante a migração. Por isso esta migration é CONDICIONAL: se o papel existe, cria as
-- policies; se não, avisa e segue (o deploy nunca quebra por causa da migração). Quem
-- cria o papel depois roda `infra/migracao-supabase/criar-papel-migracao-carteira.sql`,
-- que recria as mesmas policies (idempotente). Sem policy, o papel não vê nem escreve
-- nada: a falha é segura e visível.
--
-- Forward-only, EXPAND: só policies novas. As três tabelas globais não entram:
-- escrever nelas exige `app_carteira_pode_administrar()`.
-- ===========================================================================

DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migracao_carteira') THEN
    RAISE NOTICE 'papel migracao_carteira ausente: policies serao criadas por criar-papel-migracao-carteira.sql';
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY[
    'clientes_carteira', 'parceiros_do_cliente', 'planilhas_do_cliente',
    'indicadores_carteira', 'metas_comerciais', 'lancamentos_de_indicador',
    'reunioes_comerciais', 'itens_de_tarefa_interna', 'materiais_carteira'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO migracao_carteira USING (app_pode_ver_grupo(grupo_id))',
      t || '_migracao_leitura', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO migracao_carteira WITH CHECK (app_pode_ver_grupo(grupo_id))',
      t || '_migracao_insercao', t);
  END LOOP;
  CREATE POLICY cobrancas_do_cliente_firmare_migracao_leitura ON cobrancas_do_cliente_firmare
    FOR SELECT TO migracao_carteira USING (app_pode_ver_grupo(grupo_id));
END $$;

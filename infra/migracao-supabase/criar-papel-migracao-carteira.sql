-- Papel de banco da carga da migração do Supabase. NÃO é migration: `fir_migrate`
-- não tem CREATEROLE, e o papel só existe enquanto a migração dura.
--
--   psql -U <superusuario> -d fir -v senha="'<senha-forte>'" -f criar-papel-migracao-carteira.sql
--
-- Pré-requisito: tabelas da carteira existentes (migrations até a 0074). Este arquivo também cria as policies do papel.
--
-- Propriedades (verificadas por `teste/migracao-supabase.test.ts`):
--   * NÃO é dono de nada, NÃO tem BYPASSRLS, não é superusuário, não cria papel/banco;
--   * NÃO é membro de `fir_carteira`: o GRANT abaixo é tudo o que ele tem;
--   * SELECT e INSERT apenas. Sem UPDATE e sem DELETE em tabela nenhuma: o BANCO recusa
--     (nas 9 tabelas cobertas pela 0074 a RLS forçada recusa mesmo com GRANT; em tarefas_internas e
--     rotinas_internas só o GRANT bloqueia, então nunca conceda UPDATE/DELETE ali);
--   * escopo de linha pela RLS: a carga fixa `app.escopo = 'grupo'` e `app.grupo_id`.
CREATE ROLE migracao_carteira LOGIN PASSWORD :senha
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;

GRANT USAGE ON SCHEMA public TO migracao_carteira;

GRANT SELECT, INSERT ON
  clientes_carteira, parceiros_do_cliente, planilhas_do_cliente,
  rotinas_internas, indicadores_carteira, metas_comerciais, lancamentos_de_indicador,
  reunioes_comerciais, tarefas_internas, itens_de_tarefa_interna, materiais_carteira
  TO migracao_carteira;

-- Conferência: lê cobranças para provar que a carga não gerou receita.
GRANT SELECT ON cobrancas_do_cliente_firmare TO migracao_carteira;

-- Só o que a carga consulta, por coluna (nunca `senha_hash` etc.).
GRANT SELECT (id, ativo) ON grupos TO migracao_carteira;
GRANT SELECT (id) ON usuarios_gestao TO migracao_carteira;

-- Tabelas globais (mensagens, roteiros, biblioteca): SEM acesso. Exigem
-- `app_carteira_pode_administrar()`; entram pelo procedimento do Operador (README).

-- Policies do papel (as mesmas da migration 0074, que só as cria se o papel já existia
-- quando ela rodou). Idempotente: pode rodar em qualquer ordem em relação à 0074.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clientes_carteira', 'parceiros_do_cliente', 'planilhas_do_cliente',
    'indicadores_carteira', 'metas_comerciais', 'lancamentos_de_indicador',
    'reunioes_comerciais', 'itens_de_tarefa_interna', 'materiais_carteira'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_migracao_leitura', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_migracao_insercao', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO migracao_carteira USING (app_pode_ver_grupo(grupo_id))',
      t || '_migracao_leitura', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO migracao_carteira WITH CHECK (app_pode_ver_grupo(grupo_id))',
      t || '_migracao_insercao', t);
  END LOOP;
  DROP POLICY IF EXISTS cobrancas_do_cliente_firmare_migracao_leitura ON cobrancas_do_cliente_firmare;
  CREATE POLICY cobrancas_do_cliente_firmare_migracao_leitura ON cobrancas_do_cliente_firmare
    FOR SELECT TO migracao_carteira USING (app_pode_ver_grupo(grupo_id));
END $$;

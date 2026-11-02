#!/bin/sh
# Os papéis do banco, em produção.
#
# É o equivalente de `infra/bootstrap-papeis.sql`, com uma diferença que
# decide tudo: **as senhas vêm do ambiente, não do arquivo.** O bootstrap
# local tem `fir_local_dev` escrito nele porque aquele container escuta em
# 127.0.0.1 e o `fir reset` apaga os dados; aqui as senhas são segredo, e
# segredo não entra em arquivo versionado.
#
# Roda **uma vez**, na criação do volume, pelo `docker-entrypoint-initdb.d` do
# Postgres. Se o volume já existir, este arquivo é ignorado — o que é o
# comportamento certo: reexecutar trocaria a senha de papéis em uso.
#
# `fir_painel` NÃO nasce aqui, e a razão é operacional: o painel foi
# construído depois, e as instalações que já existem têm volume criado. Ele
# nasce em `provisionar-painel.sh`, contra um banco que já existe.
set -eu

: "${SENHA_MIGRATE:?SENHA_MIGRATE não definida}"
: "${SENHA_APP:?SENHA_APP não definida}"

# `--single-transaction`: ou os papéis todos existem, ou nenhum. Um
# provisionamento pela metade deixa o banco num estado que a primeira
# migration não sabe interpretar.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
     --single-transaction --set ON_ERROR_STOP=1 \
     --set senha_migrate="$SENHA_MIGRATE" \
     --set senha_app="$SENHA_APP" <<'SQL'

DO $$
BEGIN
  -- BYPASSRLS: é o único papel da instalação que o tem, e só ele roda
  -- migration. Rodar a aplicação com um papel que atravessa a RLS faria todo
  -- teste de isolamento passar sem provar coisa alguma — e, em produção,
  -- faria a clínica A ler o paciente da B sem nenhum erro no caminho.
  --
  -- Sem CREATEROLE, ao contrário do Mavia: aqui nenhuma migration cria papel.
  -- `fir_app` nasce abaixo e `fir_painel` nasce no provisionamento.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fir_migrate') THEN
    CREATE ROLE fir_migrate LOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fir_app') THEN
    CREATE ROLE fir_app LOGIN;
  END IF;
END
$$;

-- `:'var'` é a forma do psql para literal com aspas. A senha entra por
-- variável e não por interpolação de shell: assim ela não aparece na lista de
-- processos nem num `set -x`.
ALTER ROLE fir_migrate PASSWORD :'senha_migrate';
ALTER ROLE fir_app     PASSWORD :'senha_app';

-- `fir_migrate` precisa ser DONO do esquema, e não apenas ter CREATE nele.
--
-- O motivo é um comportamento traiçoeiro do PostgreSQL: um `GRANT` executado
-- por quem não é dono nem tem grant option **não falha**. Devolve `GRANT` com
-- um `WARNING: no privileges were granted`, e a transação segue. A migration
-- reporta sucesso, o privilégio não existe, e a aplicação perde acesso a
-- todas as tabelas sem nenhum erro para investigar.
GRANT ALL ON SCHEMA public TO fir_migrate;
ALTER SCHEMA public OWNER TO fir_migrate;

-- Sem isto a migration 0001 falha com "permission denied to create extension
-- pgcrypto": mesmo sendo `pgcrypto` uma extensão `trusted`, o Postgres exige
-- privilégio CREATE no *banco*, não só no schema.
DO $$
BEGIN
  EXECUTE format('GRANT CREATE ON DATABASE %I TO fir_migrate', current_database());
END
$$;

-- Tudo que `fir_migrate` criar daqui em diante fica legível e gravável por
-- `fir_app`. Sem isto, cada migration precisaria repetir os GRANTs — e a que
-- esquecesse deixaria a API sem acesso à tabela nova.
--
-- O preço disto está escrito em `teste/escrita-sem-rls.test.ts`: TODA relação
-- sem RLS nasce gravável por `fir_app`, e precisa de um `REVOKE` explícito.
-- É exatamente por isso que a 0013 revoga as quatro tabelas do painel.
ALTER DEFAULT PRIVILEGES FOR ROLE fir_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fir_app;
ALTER DEFAULT PRIVILEGES FOR ROLE fir_migrate IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO fir_app;
SQL

echo "papéis provisionados: fir_migrate, fir_app"
echo "fir_painel NÃO: rode ./provisionar-painel.sh ANTES de migrar."

#!/bin/sh
# O papel do PAINEL do superadmin — `fir_painel`.
#
# ## Por que isto não é uma migration
#
# Duas razões independentes, e cada uma sozinha bastaria:
#
# 1. **`fir_migrate` não tem `CREATEROLE`** (ver `10-papeis.sh`), e dar-lhe
#    esse privilégio para criar um papel privilegiado seria trocar o problema
#    de lugar: quem tem CREATEROLE cria um papel com BYPASSRLS e volta por ele.
# 2. **Uma migration com senha dentro fica no repositório para sempre.** Quem
#    dá credencial é o provisionamento do ambiente — este arquivo — e ele lê a
#    senha do `.env`, que não é versionado.
#
# A migration `0013` **falha alto** se o papel não existir, ou se alguém lhe
# der `BYPASSRLS`, `SUPERUSER` ou `CREATEROLE`. É por isso que a ordem é:
#
#     ./provisionar-painel.sh   →   db:migrate   →   ./redefinir-superadmin.sh
#
# Fora de ordem, a 0013 para e o `RAISE EXCEPTION` dela diz exatamente isto.
#
# ## O que o papel NÃO tem, e isso é a decisão
#
# `fir_painel` é um papel **comum**: sem BYPASSRLS, sem SUPERUSER, sem
# CREATEROLE. O superadmin fixa `app.clinica_id` da clínica em que opera, como
# qualquer um (D-10). Um painel que atravessa a RLS desfaz o isolamento que
# sustenta o produto inteiro, e o faz em silêncio — nenhum erro, só linhas a
# mais.
#
# **Idempotente.** Rodar de novo não troca a senha de um papel em uso: a chave
# é acrescentada ao `.env` uma única vez, e o `ALTER ROLE` usa o valor que já
# está lá.
set -eu

cd "$(dirname "$0")"
AMBIENTE=.env

[ -f "$AMBIENTE" ] || { echo "ERRO: $AMBIENTE não existe. Crie-o antes." >&2; exit 1; }

acrescentar_segredo() {
  if ! grep -q "^$1=" "$AMBIENTE"; then
    echo "==> acrescentando $1 a $AMBIENTE"
    printf '%s=%s\n' "$1" "$(head -c 32 /dev/urandom | base64 | tr -d '=+/' | cut -c1-40)" >> "$AMBIENTE"
  fi
}

acrescentar_linha() {
  if ! grep -q "^$1=" "$AMBIENTE"; then
    echo "==> acrescentando $1 a $AMBIENTE"
    printf '%s=%s\n' "$1" "$2" >> "$AMBIENTE"
  fi
}

acrescentar_segredo SENHA_PAINEL

set -a
# shellcheck disable=SC1090
. "./$AMBIENTE"
set +a

# A URL que a API procura. Sem ela, `DATABASE_URL_PAINEL:?` no compose
# **impede o `up`** — e isso é o certo: subir o painel apontando para o padrão
# local seria subir um painel que não funciona, mas parece existir.
acrescentar_linha DATABASE_URL_PAINEL \
  "postgresql://fir_painel:${SENHA_PAINEL}@postgres:5432/fir"

set -a
# shellcheck disable=SC1090
. "./$AMBIENTE"
set +a

echo "==> criando/credenciando fir_painel"
# `--set` e não interpolação de shell: a senha não aparece na lista de
# processos, e um valor com aspas não vira injeção.
docker compose exec -T -e PGPASSWORD="$SENHA_POSTGRES" postgres \
  psql --username fir --dbname fir --single-transaction --set ON_ERROR_STOP=1 \
       --set senha_painel="$SENHA_PAINEL" <<'SQL'

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fir_painel') THEN
    CREATE ROLE fir_painel LOGIN;
  END IF;
END
$$;

ALTER ROLE fir_painel PASSWORD :'senha_painel';

-- E o papel é REBAIXADO a cada execução, de propósito.
--
-- Se alguém tiver dado BYPASSRLS "para depurar mais rápido", este bloco
-- desfaz. Não basta criar o papel certo uma vez: o modo como ele deixa de
-- estar certo é alguém o alterar à mão numa madrugada, e nada avisar.
ALTER ROLE fir_painel NOBYPASSRLS NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION;

-- A asserção que vale mais que os comandos acima: se o rebaixamento não
-- pegou, o provisionamento PARA, em vez de deixar passar.
DO $$
BEGIN
  IF (SELECT rolbypassrls OR rolsuper OR rolcreaterole
        FROM pg_roles WHERE rolname = 'fir_painel') THEN
    RAISE EXCEPTION 'fir_painel ficou com BYPASSRLS, SUPERUSER ou CREATEROLE'
      USING HINT = 'D-10: o superadmin NUNCA atravessa a RLS.';
  END IF;
END
$$;

SQL

echo
echo "fir_painel provisionado. Ordem obrigatória daqui:"
echo
echo "  1. pnpm --filter @fir/api db:migrate   (a 0013 confere o papel)"
echo "  2. ./redefinir-superadmin.sh <usuario> (cria o PRIMEIRO operador)"
echo
echo "O painel não tem como criar um operador antes de existir um."

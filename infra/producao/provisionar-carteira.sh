#!/bin/sh
# O papel da CARTEIRA COMERCIAL DA FIRMARE — `fir_carteira`.
#
# Este script não existia no deploy original do FIR (que não tinha a Carteira
# Comercial). A migration `0025_carteira_fundacao.sql` (ADR 0011, 0012) exige
# o papel ANTES de migrar, e falha alto se ele faltar — exatamente como a 0013
# falha para `fir_painel`. Este arquivo é a cópia fiel de
# `provisionar-painel.sh` para o terceiro papel.
#
# ## Por que isto não é uma migration
#
# As mesmas duas razões de `provisionar-painel.sh`:
#
# 1. `fir_migrate` não tem `CREATEROLE` — dar-lhe esse privilégio para criar
#    um papel privilegiado troca o problema de lugar.
# 2. Uma migration com senha dentro fica no repositório para sempre. Quem dá
#    credencial é o provisionamento do ambiente, que lê a senha do `.env`.
#
# A migration `0025` falha alto se o papel não existir, ou se alguém lhe der
# `BYPASSRLS`, `SUPERUSER` ou `CREATEROLE`. Por isso a ordem é:
#
#     ./provisionar-carteira.sh   →   db:migrate   →   (Carteira operável)
#
# ## O que o papel NÃO tem, e isso é a decisão
#
# `fir_carteira` é um papel comum: sem BYPASSRLS, sem SUPERUSER, sem
# CREATEROLE. Ele fixa `app.grupo_id`/`app.escopo` como qualquer um (ADR
# 0012) — nunca atravessa o isolamento por clínica quando opera dentro de
# uma. Um papel da carteira que atravessa a RLS desfaz o isolamento que
# sustenta o produto inteiro, em silêncio.
#
# **Idempotente.** Rodar de novo não troca a senha de um papel em uso: a
# chave é acrescentada ao `.env` uma única vez.
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

acrescentar_segredo SENHA_CARTEIRA

set -a
# shellcheck disable=SC1090
. "./$AMBIENTE"
set +a

# A URL que a API procura. Sem ela, `DATABASE_URL_CARTEIRA:?` no compose
# **impede o `up`** — subir a carteira apontando para o padrão local seria
# subir algo que não funciona, mas parece existir.
acrescentar_linha DATABASE_URL_CARTEIRA \
  "postgresql://fir_carteira:${SENHA_CARTEIRA}@postgres:5432/fir"

set -a
# shellcheck disable=SC1090
. "./$AMBIENTE"
set +a

echo "==> criando/credenciando fir_carteira"
# `--set` e não interpolação de shell: a senha não aparece na lista de
# processos, e um valor com aspas não vira injeção.
docker compose exec -T -e PGPASSWORD="$SENHA_POSTGRES" postgres \
  psql --username fir --dbname fir --single-transaction --set ON_ERROR_STOP=1 \
       --set senha_carteira="$SENHA_CARTEIRA" <<'SQL'

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fir_carteira') THEN
    CREATE ROLE fir_carteira LOGIN;
  END IF;
END
$$;

ALTER ROLE fir_carteira PASSWORD :'senha_carteira';

-- E o papel é REBAIXADO a cada execução, de propósito.
--
-- Se alguém tiver dado BYPASSRLS "para depurar mais rápido", este bloco
-- desfaz. Não basta criar o papel certo uma vez: o modo como ele deixa de
-- estar certo é alguém o alterar à mão numa madrugada, e nada avisar.
ALTER ROLE fir_carteira NOBYPASSRLS NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION;

-- A asserção que vale mais que os comandos acima: se o rebaixamento não
-- pegou, o provisionamento PARA, em vez de deixar passar.
DO $$
BEGIN
  IF (SELECT rolbypassrls OR rolsuper OR rolcreaterole
        FROM pg_roles WHERE rolname = 'fir_carteira') THEN
    RAISE EXCEPTION 'fir_carteira ficou com BYPASSRLS, SUPERUSER ou CREATEROLE'
      USING HINT = 'ADR 0012: a carteira NUNCA atravessa a RLS.';
  END IF;
END
$$;

SQL

echo
echo "fir_carteira provisionado. Prossiga com as migrations."

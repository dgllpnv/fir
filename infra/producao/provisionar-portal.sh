#!/bin/sh
# O papel do PORTAL DO GRUPO — `fir_portal` (G6, ADR 0018).
#
# Mesma razão de `provisionar-carteira.sh`, um ator mais. A migration
# `0034_carteira_portal.sql` exige o papel ANTES de migrar e falha alto se
# faltar — mesma forma de `fir_painel` (0013) e `fir_carteira` (0025).
#
# ## O que o papel NÃO tem, e isso é a decisão
#
# `fir_portal` é um papel comum: sem BYPASSRLS, sem SUPERUSER, sem
# CREATEROLE. Ele fixa `app.portal_grupo_id`/`app.portal_cliente_id` como
# qualquer um — nunca atravessa o isolamento por grupo/cliente (ADR 0018 §3).
#
# **Idempotente.** Rodar de novo não troca a senha de um papel em uso.
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

acrescentar_segredo SENHA_PORTAL

set -a
# shellcheck disable=SC1090
. "./$AMBIENTE"
set +a

# A URL que a API procura. Sem ela, `DATABASE_URL_PORTAL:?` no compose
# **impede o `up`**.
acrescentar_linha DATABASE_URL_PORTAL \
  "postgresql://fir_portal:${SENHA_PORTAL}@postgres:5432/fir"

set -a
# shellcheck disable=SC1090
. "./$AMBIENTE"
set +a

echo "==> criando/credenciando fir_portal"
docker compose exec -T -e PGPASSWORD="$SENHA_POSTGRES" postgres \
  psql --username fir --dbname fir --single-transaction --set ON_ERROR_STOP=1 \
       --set senha_portal="$SENHA_PORTAL" <<'SQL'

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fir_portal') THEN
    CREATE ROLE fir_portal LOGIN;
  END IF;
END
$$;

ALTER ROLE fir_portal PASSWORD :'senha_portal';

-- Rebaixado a cada execução, de propósito — ver provisionar-carteira.sh.
ALTER ROLE fir_portal NOBYPASSRLS NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION;

DO $$
BEGIN
  IF (SELECT rolbypassrls OR rolsuper OR rolcreaterole
        FROM pg_roles WHERE rolname = 'fir_portal') THEN
    RAISE EXCEPTION 'fir_portal ficou com BYPASSRLS, SUPERUSER ou CREATEROLE'
      USING HINT = 'ADR 0018 §3: o portal NUNCA atravessa a RLS.';
  END IF;
END
$$;

SQL

echo
echo "fir_portal provisionado. Prossiga com as migrations."

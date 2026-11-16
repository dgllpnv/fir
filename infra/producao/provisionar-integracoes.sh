#!/bin/sh
# O papel das INTEGRAÇÕES — `fir_integracoes` (migration 0092, spec
# `docs/specs/integracao-medx.md` A.2).
#
# É o único papel que lê o segredo selado da chave do MedX de cada clínica, e
# só o `worker-agenda` o usa. A migration 0092 exige o papel ANTES de migrar e
# falha alto se faltar — mesma forma de `fir_portal` (0034).
#
# ## O que o papel NÃO tem, e isso é a decisão
#
# Sem BYPASSRLS, sem SUPERUSER, sem CREATEROLE: o worker lê conteúdo da
# internet e abre a integração de cada clínica dentro de `naClinica`.
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

acrescentar_segredo SENHA_INTEGRACOES

set -a
# shellcheck disable=SC1090
. "./$AMBIENTE"
set +a

# A URL que a API procura. Sem ela, `DATABASE_URL_INTEGRACOES:?` no compose
# **impede o `up`**.
acrescentar_linha DATABASE_URL_INTEGRACOES \
  "postgresql://fir_integracoes:${SENHA_INTEGRACOES}@postgres:5432/fir"

set -a
# shellcheck disable=SC1090
. "./$AMBIENTE"
set +a

echo "==> criando/credenciando fir_integracoes"
docker compose exec -T -e PGPASSWORD="$SENHA_POSTGRES" postgres \
  psql --username fir --dbname fir --single-transaction --set ON_ERROR_STOP=1 \
       --set senha_integracoes="$SENHA_INTEGRACOES" <<'SQL'

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fir_integracoes') THEN
    CREATE ROLE fir_integracoes LOGIN;
  END IF;
END
$$;

ALTER ROLE fir_integracoes PASSWORD :'senha_integracoes';

-- Rebaixado a cada execução, de propósito — ver provisionar-carteira.sh.
ALTER ROLE fir_integracoes NOBYPASSRLS NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION;

DO $$
BEGIN
  IF (SELECT rolbypassrls OR rolsuper OR rolcreaterole
        FROM pg_roles WHERE rolname = 'fir_integracoes') THEN
    RAISE EXCEPTION 'fir_integracoes ficou com BYPASSRLS, SUPERUSER ou CREATEROLE'
      USING HINT = 'Spec integracao-medx A.2: ele lê conteúdo da internet, NUNCA atravessa a RLS.';
  END IF;
END
$$;

SQL

echo
echo "fir_integracoes provisionado. Prossiga com as migrations."

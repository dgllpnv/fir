#!/usr/bin/env bash
# O ENSAIO DE RESTAURAÇÃO — a metade do backup que decide se a outra valeu.
#
#   uso:  bash restaurar-ensaio.sh [arquivo.dump.gpg]
#         (sem argumento, usa o backup mais recente)
#
# ## Por que ele existe
#
# Um `pg_dump` que ninguém restaurou é um arquivo de tamanho desconhecido.
# Este script restaura de verdade, CRONOMETRA, e compara as contagens do
# destino com as do banco vivo — tabela por tabela. Backup que "tem 12 MB" não
# prova nada; backup que reconstrói 630 pacientes prova.
#
# Rode por CALENDÁRIO, não por intenção, e anote o RTO medido em
# `docs/operacao/backup.md`. O número real, não o desejado.
#
# ## Ele NÃO TOCA no banco vivo, e isso é construído e não prometido
#
# Restaura num banco DESCARTÁVEL (`fir_ensaio`), criado e derrubado aqui. Há
# uma guarda explícita contra o nome `fir`: um `pg_restore --clean` apontado
# para o banco de produção é a forma mais rápida de transformar um ensaio de
# recuperação num desastre. Se você mudar este script, não remova a guarda.
set -euo pipefail

cd "$(dirname "$0")"

DESTINO=${DESTINO_BACKUP:-/opt/fir/backups}
CHAVE=${CHAVE_BACKUP:-/opt/fir/backup.chave}
BANCO_ENSAIO=fir_ensaio

# A GUARDA. Não a remova.
if [ "$BANCO_ENSAIO" = "fir" ]; then
  echo "ERRO: o banco de ensaio não pode ser o de produção." >&2
  exit 1
fi

[ -f .env ] || { echo "ERRO: .env não existe." >&2; exit 1; }
SENHA_POSTGRES=$(grep '^SENHA_POSTGRES=' .env | cut -d= -f2-)
[ -f "$CHAVE" ] || { echo "ERRO: chave $CHAVE não existe — nada aqui é legível sem ela." >&2; exit 1; }

# `find` e nao `ls` com glob, pela mesma razao registrada no `backup.sh`: com
# a pasta vazia o glob nao casa, o `ls` sai com status 2, o `pipefail` propaga
# e o `set -e` mata o script ANTES da checagem de "nenhum backup encontrado"
# logo abaixo — que e justamente a mensagem que explicaria o problema.
mais_recente() {
  find "$DESTINO" -maxdepth 1 -type f -name 'fir-*.dump.gpg' -printf '%T@	%p
' 2>/dev/null     | sort -rn | cut -f2- | head -1
}
ARQUIVO=${1:-$(mais_recente)}
[ -n "${ARQUIVO:-}" ] && [ -f "$ARQUIVO" ] || { echo "ERRO: nenhum backup encontrado em $DESTINO." >&2; exit 1; }

psql_() { docker compose exec -T -e PGPASSWORD="$SENHA_POSTGRES" postgres psql -U fir "$@"; }

echo "==> ensaio de restauração"
echo "    arquivo: $(basename "$ARQUIVO")  ($(stat -c %s "$ARQUIVO") bytes)"
echo "    destino: banco descartável \"$BANCO_ENSAIO\" (o banco vivo NÃO é tocado)"
echo

# ---------------------------------------------------------------------------
# 1 · o banco descartável, do zero
# ---------------------------------------------------------------------------
psql_ -d postgres -v ON_ERROR_STOP=1 -q \
  -c "DROP DATABASE IF EXISTS $BANCO_ENSAIO WITH (FORCE)" \
  -c "CREATE DATABASE $BANCO_ENSAIO OWNER fir_migrate"

# ---------------------------------------------------------------------------
# 2 · a restauração, CRONOMETRADA
# ---------------------------------------------------------------------------
# O relógio começa aqui de propósito: é o tempo de "tenho o arquivo e preciso
# dos dados de volta". O RTO completo de um incidente soma o provisionamento
# (`implantar.sh`), e isso está dito no documento — um número que esconde
# metade do caminho é pior que nenhum.
echo "==> restaurando (cronometrando)"
INICIO=$(date +%s)

set +e
SAIDA=$(gpg --batch --quiet --decrypt --passphrase-file "$CHAVE" "$ARQUIVO" \
  | docker compose exec -T -e PGPASSWORD="$SENHA_POSTGRES" postgres \
      pg_restore -U fir -d "$BANCO_ENSAIO" --no-password 2>&1)
STATUS=$?
set -e

FIM_=$(date +%s)
RTO=$((FIM_ - INICIO))
ERROS=$(printf '%s' "$SAIDA" | grep -c '^pg_restore: error' || true)

echo "    tempo de restauração: ${RTO}s · avisos/erros do pg_restore: ${ERROS:-0} · status $STATUS"
if [ "${ERROS:-0}" -gt 0 ]; then
  printf '%s\n' "$SAIDA" | grep '^pg_restore: error' | head -5
fi

# ---------------------------------------------------------------------------
# 3 · A ACEITAÇÃO: as contagens do restaurado BATEM com as do vivo
# ---------------------------------------------------------------------------
# É isto que torna o ensaio uma prova. Comparar tamanho de arquivo não prova
# nada; reconstruir as mesmas linhas, sim. Por CONTAGEM, nunca por conteúdo —
# o relatório não carrega nome de paciente (regra 21).
echo
echo "==> conferência por contagem (vivo × restaurado)"
TABELAS="clinicas pessoas perfis pacientes procedimentos programas tarefas campanhas recebimentos movimentos_de_estoque auditoria operadores"

DIVERGENTES=0
for t in $TABELAS; do
  A=$(psql_ -d fir -tAc "SELECT count(*) FROM $t" 2>/dev/null | tr -d '[:space:]' || echo erro)
  B=$(psql_ -d "$BANCO_ENSAIO" -tAc "SELECT count(*) FROM $t" 2>/dev/null | tr -d '[:space:]' || echo erro)
  if [ "$A" = "$B" ]; then
    printf '  ok   %-26s %8s = %-8s\n' "$t" "$A" "$B"
  else
    printf '  NAO  %-26s %8s ≠ %-8s\n' "$t" "$A" "$B"
    DIVERGENTES=$((DIVERGENTES + 1))
  fi
done

# A RLS tem de voltar ligada. Um restore que traz os dados e perde a política
# devolve um banco em que toda clínica lê a outra — e ele "restaurou".
RLS_VIVO=$(psql_ -d fir -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND rowsecurity" | tr -d '[:space:]')
RLS_ENSAIO=$(psql_ -d "$BANCO_ENSAIO" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND rowsecurity" | tr -d '[:space:]')
if [ "$RLS_VIVO" = "$RLS_ENSAIO" ]; then
  printf '  ok   %-26s %8s = %-8s\n' "tabelas com RLS ligada" "$RLS_VIVO" "$RLS_ENSAIO"
else
  printf '  NAO  %-26s %8s ≠ %-8s\n' "tabelas com RLS ligada" "$RLS_VIVO" "$RLS_ENSAIO"
  DIVERGENTES=$((DIVERGENTES + 1))
fi

# ---------------------------------------------------------------------------
# 4 · limpeza
# ---------------------------------------------------------------------------
psql_ -d postgres -q -c "DROP DATABASE IF EXISTS $BANCO_ENSAIO WITH (FORCE)"
echo
echo "==> banco de ensaio derrubado"

if [ "$DIVERGENTES" -ne 0 ]; then
  echo
  echo "ENSAIO REPROVADO: $DIVERGENTES conferência(s) não bateram." >&2
  echo "Este backup NÃO restaura o banco. Trate como incidente." >&2
  exit 1
fi

echo
echo "===================================================================="
echo " ENSAIO FECHADO — o backup restaura, e as contagens batem."
echo " RTO MEDIDO (dados): ${RTO}s para $(stat -c %s "$ARQUIVO") bytes cifrados."
echo " Some o provisionamento (implantar.sh) para o RTO de um incidente real."
echo "===================================================================="

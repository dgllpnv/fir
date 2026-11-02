#!/usr/bin/env bash
# O BACKUP DO BANCO DO FIR.
#
# Roda na VPS, do diretório que contém este arquivo. Pensado para o cron
# (`/etc/cron.d/fir-backup`), e seguro de rodar à mão.
#
# ## "Backup não testado não é backup"
#
# Este script faz a metade que grava. A outra metade é
# `restaurar-ensaio.sh`, e ela é a que decide se isto aqui valeu de algo —
# um `pg_dump` que ninguém restaurou é um arquivo de tamanho desconhecido.
# Rode o ensaio por calendário, não por intenção, e registre o RTO MEDIDO.
#
# ## As quatro propriedades que ele tem
#
# 1. **Cifrado em repouso**, com a chave guardada SEPARADAMENTE da senha do
#    banco: `/opt/fir/backup.chave`, fora do repositório e fora do `.env`.
#    Dado de saúde de paciente no backup segue a mesma classificação do banco
#    (LGPD art. 11), e um dump em claro ao lado do banco é uma segunda cópia
#    sem as defesas da primeira.
# 2. **Verificado**, e não só escrito: o arquivo é decifrado e lido de volta
#    por `pg_restore --list`. Um dump truncado — disco cheio no meio, pipe
#    quebrado — tem tamanho plausível e não restaura. Esse é o modo de falha
#    que só aparece no dia do incidente.
# 3. **Com retenção**: 30 diários e 12 mensais. Sem isso o disco enche, e
#    disco cheio nesta VPS derruba a produção de OUTROS negócios.
# 4. **Atômico**: escreve em `.parcial` e só renomeia no fim. Um backup
#    interrompido nunca ocupa o nome de um backup bom.
#
# ## O que ele NÃO faz, e está dito em voz alta
#
# **Não leva a cópia para fora da VPS.** Isso exige credencial de terceiro
# (ver `docs/operacao/backup.md`). Enquanto não existir, ele AVISA em toda
# execução — no mesmo disco, o backup não protege contra a morte do disco.
set -euo pipefail

cd "$(dirname "$0")"

DESTINO=${DESTINO_BACKUP:-/opt/fir/backups}
CHAVE=${CHAVE_BACKUP:-/opt/fir/backup.chave}
MANTER_DIARIOS=30
MANTER_MENSAIS=12

[ -f .env ] || { echo "ERRO: .env não existe; rode implantar.sh primeiro." >&2; exit 1; }
SENHA_POSTGRES=$(grep '^SENHA_POSTGRES=' .env | cut -d= -f2-)
[ -n "$SENHA_POSTGRES" ] || { echo "ERRO: SENHA_POSTGRES vazia no .env." >&2; exit 1; }

mkdir -p "$DESTINO/mensal"
chmod 700 "$DESTINO" "$DESTINO/mensal"

# ---------------------------------------------------------------------------
# A CHAVE, gerada uma vez e NUNCA rotacionada em silêncio
# ---------------------------------------------------------------------------
# Rotacionar a chave sem guardar a antiga torna ilegível todo backup já
# gravado — é o jeito mais rápido de transformar trinta backups em trinta
# arquivos inúteis. Então: criada se faltar, jamais sobrescrita.
if [ ! -f "$CHAVE" ]; then
  echo "==> gerando a chave de cifra em $CHAVE"
  ( umask 077; head -c 48 /dev/urandom | base64 | tr -d '\n' > "$CHAVE" )
  chmod 600 "$CHAVE"
  echo
  echo "  !! COPIE $CHAVE PARA ONDE A EQUIPE GUARDA SENHAS, AGORA."
  echo "  !! Sem ela, NENHUM backup deste banco pode ser restaurado — nem o"
  echo "  !! de hoje nem o de seis meses atrás. Ela não está no .env de"
  echo "  !! propósito: perder os dois juntos não pode ser um evento só."
  echo
fi

AGORA=$(date -u +%Y-%m-%dT%H%M%SZ)
HOJE=$(date -u +%d)
ARQUIVO="$DESTINO/fir-$AGORA.dump.gpg"
PARCIAL="$ARQUIVO.parcial"

limpar() { rm -f "$PARCIAL"; }
trap limpar EXIT

echo "==> pg_dump -Fc | gpg  →  $(basename "$ARQUIVO")"

# `-Fc`: formato custom, já comprimido, e o único que o `pg_restore` lê
# seletivamente — é ele que permite restaurar UMA tabela num incidente em vez
# do banco inteiro.
#
# `--no-password` para falhar em vez de ficar esperando num prompt dentro do
# cron. `set -o pipefail` acima faz o erro do pg_dump derrubar o pipe inteiro:
# sem isso, o status seria o do gpg, que teria "sucesso" ao cifrar nada.
#
# gpg simétrico com AES256: ele traz MDC (integridade), então uma alteração no
# arquivo é DETECTADA ao decifrar. `openssl enc` puro não autentica, e um
# backup que decifra para lixo sem reclamar é pior que um backup ausente.
docker compose exec -T -e PGPASSWORD="$SENHA_POSTGRES" postgres \
  pg_dump -U fir -d fir -Fc --no-password \
  | gpg --batch --quiet --yes --symmetric --cipher-algo AES256 \
        --passphrase-file "$CHAVE" --output "$PARCIAL"

TAMANHO=$(stat -c %s "$PARCIAL")
[ "$TAMANHO" -gt 1024 ] || { echo "ERRO: dump de $TAMANHO bytes — é pequeno demais para ser verdade." >&2; exit 1; }

# ---------------------------------------------------------------------------
# A VERIFICAÇÃO — a diferença entre um backup e um arquivo
# ---------------------------------------------------------------------------
# Decifra e lê o índice do archive. Se o gpg falhar (integridade) ou o
# `pg_restore -l` não reconhecer o formato (truncado), o backup é RECUSADO e o
# nome definitivo não é criado.
echo "==> verificando o arquivo (gpg + pg_restore --list)"
OBJETOS=$(gpg --batch --quiet --decrypt --passphrase-file "$CHAVE" "$PARCIAL" \
  | docker compose exec -T postgres pg_restore --list 2>/dev/null \
  | grep -c '^[0-9]' || true)
if [ "${OBJETOS:-0}" -lt 50 ]; then
  echo "ERRO: o archive listou apenas ${OBJETOS:-0} objetos — backup RECUSADO." >&2
  echo "  Um dump deste banco tem centenas. Não confie neste arquivo." >&2
  exit 1
fi

mv "$PARCIAL" "$ARQUIVO"
chmod 600 "$ARQUIVO"
trap - EXIT

# Cópia mensal no dia 01. `cp -l` (hard link) e não `cp`: o conteúdo é o mesmo
# arquivo, então a retenção mensal custa um inode, não mais um dump.
if [ "$HOJE" = "01" ]; then
  cp -l "$ARQUIVO" "$DESTINO/mensal/$(basename "$ARQUIVO")"
  echo "==> cópia mensal registrada"
fi

# ---------------------------------------------------------------------------
# Retenção
# ---------------------------------------------------------------------------
# `find`, e NAO `ls` com glob: numa pasta vazia — que e o estado do `mensal/`
# em todo mes antes do dia 01 — o glob nao casa, o `ls` sai com status 2, o
# `pipefail` propaga, e o `set -e` MATA o script. Efeito medido na primeira
# execucao real: o backup ja estava gravado e verificado, e ainda assim o
# script saiu com codigo 2, sem imprimir o resumo. Um backup bom relatado como
# falha treina quem opera a ignorar o alarme.
podar() {
  local pasta=$1 manter=$2
  local arquivos=() total i
  while IFS= read -r linha; do arquivos+=("$linha"); done < <(
    find "$pasta" -maxdepth 1 -type f -name 'fir-*.dump.gpg' -printf '%T@	%p
' 2>/dev/null       | sort -rn | cut -f2-
  )
  total=${#arquivos[@]}
  [ "$total" -gt "$manter" ] || return 0
  for ((i = manter; i < total; i++)); do
    echo "    retencao: removendo $(basename "${arquivos[i]}")"
    shred -u "${arquivos[i]}" 2>/dev/null || rm -f "${arquivos[i]}"
  done
}

# Mesma razao: contar com `find`, nunca com glob que pode nao casar.
quantos() { find "$1" -maxdepth 1 -type f -name 'fir-*.dump.gpg' 2>/dev/null | wc -l; }
podar "$DESTINO" "$MANTER_DIARIOS"
podar "$DESTINO/mensal" "$MANTER_MENSAIS"

printf '%s  %s  %s bytes  %s objetos\n' "$AGORA" "$(basename "$ARQUIVO")" "$TAMANHO" "$OBJETOS" \
  >> "$DESTINO/manifesto.txt"

echo "==> ok: $(basename "$ARQUIVO") · $TAMANHO bytes · $OBJETOS objetos"
echo "    diarios: $(quantos "$DESTINO")/$MANTER_DIARIOS · mensais: $(quantos "$DESTINO/mensal")/$MANTER_MENSAIS"
echo "    disco: $(df -h "$DESTINO" | tail -1 | awk '{print $5" usado, "$4" livre"}')"

# ---------------------------------------------------------------------------
# O AVISO QUE NÃO DEVE PARAR DE APARECER
# ---------------------------------------------------------------------------
if [ ! -f /opt/fir/backup-remoto.conf ]; then
  echo
  echo "  ATENCAO: este backup esta NO MESMO DISCO do banco."
  echo "  Se o disco morrer, ele morre junto — isso nao e backup, e copia."
  echo "  Falta so a credencial do destino remoto: ver docs/operacao/backup.md."
fi

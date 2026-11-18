#!/usr/bin/env bash
# O deploy do Firmare Rotinas de Gestão.
#
# Roda **na VPS**, do diretório que contém este arquivo. É idempotente: rodar
# duas vezes não recria segredo, não reaplica migration e não perde dado.
#
# ## A ordem, e por que ela é essa
#
#   1. segredos — gerados uma vez, e nunca no repositório
#   2. a guarda da allowlist do painel
#   3. Postgres e Redis, e esperar ficarem saudáveis de verdade
#   4. `fir_painel` (provisionar-painel.sh), que não é migration
#   5. migrations, como `fir_migrate` — o único papel com BYPASSRLS
#   6. API, web e worker-agenda (depois das migrations: o worker lê tabelas
#      que elas criam)
#   7. verificação
#
# O passo 6 do README — `./redefinir-superadmin.sh` — **não** está aqui, de
# propósito: ele imprime uma senha na tela, e um passo que imprime segredo não
# pertence a um script que alguém roda de novo por reflexo.
#
# ## A ARMADILHA DA ORDEM, medida e não deduzida
#
# O README manda subir o Postgres (passo 2) ANTES de provisionar o painel
# (passo 3). **Isso não funciona**, e a razão não é óbvia: o Compose interpola
# o arquivo INTEIRO antes de decidir o que subir, então
# `DATABASE_URL_PAINEL:?` na definição da `api` derruba até
# `docker compose up -d postgres`. Medido:
#
#   error while interpolating services.api.environment.DATABASE_URL_PAINEL:
#   required variable DATABASE_URL_PAINEL is missing a value
#
# E `provisionar-painel.sh` usa `docker compose exec`, então ele também falha —
# o passo que existe para resolver a pendência não consegue rodar. É um laço.
#
# A saída é escrever `SENHA_PAINEL` e `DATABASE_URL_PAINEL` no `.env` **aqui,
# antes de qualquer comando do Compose**. O `provisionar-painel.sh` continua
# sendo quem CRIA e credencia o papel no Postgres — ele acrescenta a chave só
# se faltar, então encontra as duas já lá e vai direto ao SQL. A guarda `:?`
# continua valendo para quem rodar o Compose à mão com um `.env` incompleto,
# que é de quem ela sempre foi.
set -euo pipefail

cd "$(dirname "$0")"

AMBIENTE=.env

# ---------------------------------------------------------------------------
# 1 · segredos
# ---------------------------------------------------------------------------
# Gerados **na máquina**, uma vez, com 32 bytes de urandom. Nunca passam por
# conversa, por commit, nem por variável de ambiente de CI.
segredo() { head -c 32 /dev/urandom | base64 | tr -d '=+/' | cut -c1-40; }

if [ ! -f "$AMBIENTE" ]; then
  echo "==> gerando segredos em $AMBIENTE"
  cat > "$AMBIENTE" <<FIM
# Gerado por implantar.sh. **Não versionar.**
#
# Perder este arquivo com o volume do Postgres vivo torna o banco inacessível:
# as senhas de fir_migrate, fir_app e fir_painel estão dentro dele, e só dentro
# dele. COPIE-O para onde a equipe guarda senhas antes de qualquer coisa.
DOMINIO=${DOMINIO:-fir.o9cmue.easypanel.host}
VERSAO=${VERSAO:-mais-recente}

SENHA_POSTGRES=$(segredo)
SENHA_MIGRATE=$(segredo)
SENHA_APP=$(segredo)
SENHA_REDIS=$(segredo)
FIM
  chmod 600 "$AMBIENTE"
else
  echo "==> $AMBIENTE já existe; mantendo os segredos"
fi

# **600 em toda execução, e não só na criação.** O arquivo tem as senhas do
# banco; um `chmod` perdido num editor não deve sobreviver a um deploy.
chmod 600 "$AMBIENTE"

# Chaves acrescentadas depois da primeira instalação.
#
# Sem este bloco, uma chave nova só existiria em instalação nova — e a que está
# no ar, que é justamente a que precisa dela, subiria quebrada no `:?` do
# compose. Cada chave é acrescentada **uma vez**, e nunca sobrescrita: quem já
# tem valor definido continua com o dele, porque trocar a senha de um papel em
# uso derruba a aplicação.
acrescentar_segredo() {
  if ! grep -q "^$1=" "$AMBIENTE"; then
    echo "==> acrescentando $1 a $AMBIENTE"
    printf '%s=%s\n' "$1" "$(segredo)" >> "$AMBIENTE"
  fi
}

# **Imprime só o NOME da chave, nunca o valor.** A primeira versão desta função
# imprimia `$1=$2` "para o operador conferir", e a primeira execução de verdade
# despejou a senha de `fir_painel` inteira na saída do deploy —
# `DATABASE_URL_PAINEL` tem a senha dentro da URL. Saída de deploy vai para
# terminal, para histórico de shell e para onde quem implanta colar o resultado.
#
# Quando o valor é fixo e público (`IPS_DO_PAINEL=127.0.0.1/32`), ver o valor
# ajuda; quando é segredo, ver o valor é um incidente. A função não tem como
# saber qual é qual, então não imprime nenhum — quem quiser conferir lê o
# arquivo, que é modo 600.
acrescentar_linha() {
  if ! grep -q "^$1=" "$AMBIENTE"; then
    echo "==> acrescentando $1 a $AMBIENTE"
    printf '%s=%s\n' "$1" "$2" >> "$AMBIENTE"
  fi
}

acrescentar_segredo SENHA_REDIS

# As duas chaves do painel, ANTES de qualquer comando do Compose — ver "a
# armadilha da ordem" no cabeçalho. `provisionar-painel.sh` usa exatamente
# estes nomes e o mesmo "acrescentar só se faltar", então as duas execuções
# concordam em vez de competir.
acrescentar_segredo SENHA_PAINEL

# As chaves da CARTEIRA COMERCIAL e do PORTAL DO GRUPO, pela mesma razão: as
# migrations 0025 e 0034 exigem fir_carteira/fir_portal ANTES de migrar.
# provisionar-carteira.sh e provisionar-portal.sh usam os mesmos nomes.
acrescentar_segredo SENHA_CARTEIRA
acrescentar_segredo SENHA_PORTAL

# A chave de cifra dos ANEXOS da carteira (G8 4C, A-13). Mesma regra: uma vez,
# nunca sobrescrita — trocá-la deixa ilegível todo arquivo já gravado no
# volume `anexos-dados`. Guarde-a junto das senhas: sem ela, o backup do
# volume é ruído cifrado.
acrescentar_segredo CHAVE_ANEXOS

# A chave do HMAC da lista de "não contatar" da prospecção (G8 1E). Também
# nunca é sobrescrita: trocá-la faz a lista de supressão deixar de reconhecer
# quem pediu para sair, e a pessoa volta a ser contatada.
acrescentar_segredo FIR_CHAVE_SUPRESSAO_DE_CONTATO

# A chave do SEGUNDO FATOR da carteira (G8 0.6, A-12): cifra o segredo TOTP de
# cada Usuário de Gestão (AES-256-GCM) e é o pepper dos códigos de
# recuperação. Uma vez, nunca sobrescrita — trocá-la deixa todo segredo
# ilegível, e cada Usuário de Gestão precisaria de um reset pelo Operador.
# Guarde-a junto das senhas.
acrescentar_segredo FIR_CHAVE_SEGUNDO_FATOR_CARTEIRA

# AS INTEGRAÇÕES (MedX, spec integracao-medx A.2). A divisão é o ponto (gate
# S-2): a API SELA a chave de cada clínica com a PÚBLICA e nunca a abre; só o
# worker-agenda tem a PRIVADA. O pepper da impressão (unicidade global da
# chave) fica na API.
#
# Uma vez, nunca sobrescritos. Perder a privada não perde dado de paciente,
# mas obriga a colar de novo a chave do MedX de TODAS as clínicas — guarde-a
# junto das senhas, fora do dump do banco.
acrescentar_segredo SENHA_INTEGRACOES
acrescentar_segredo FIR_INTEGRACOES_PEPPER
if ! grep -q '^FIR_INTEGRACOES_CHAVE_PRIVADA=' "$AMBIENTE"; then
  command -v openssl >/dev/null 2>&1 || { echo "ERRO: openssl é necessário para gerar o par das integrações." >&2; exit 1; }
  echo "==> gerando o par de chaves das integrações (X25519)"
  privada_der=$(openssl genpkey -algorithm X25519 -outform DER | base64 | tr -d '\n')
  publica_der=$(printf '%s' "$privada_der" | base64 -d | openssl pkey -inform DER -pubout -outform DER | base64 | tr -d '\n')
  if [ -z "$privada_der" ] || [ -z "$publica_der" ]; then
    echo "ERRO: falha ao gerar o par das integrações." >&2
    exit 1
  fi
  printf 'FIR_INTEGRACOES_CHAVE_PRIVADA=%s\nFIR_INTEGRACOES_CHAVE_PUBLICA=%s\n' "$privada_der" "$publica_der" >> "$AMBIENTE"
  unset privada_der publica_der
fi

# A chave que nasce com **valor fechado**, e não vazia — é a terceira
# categoria, e a diferença é de segurança, não de estilo.
#
# Uma linha `IPS_DO_PAINEL=` lê-se, para quem abre o `.env`, como "sem
# restrição" — e é o contrário. E a recuperação de lockout reescreve esta linha
# com `sed`; **sem linha, o `sed` não casa nada e falha em silêncio**, deixando
# o operador convencido de que se liberou.
#
# `127.0.0.1/32` é sintaticamente válido e semanticamente inútil pela internet:
# ele não é alcançável nem a partir do próprio host, porque uma conexão do host
# chega ao container com o endereço do gateway da bridge. Quem tem shell na VPS
# já tem root — a allowlist nunca teve como defender contra ele.
acrescentar_linha IPS_DO_PAINEL 127.0.0.1/32

set -a
# shellcheck disable=SC1090
. "./$AMBIENTE"
set +a

# `DATABASE_URL_PAINEL` depende de `SENHA_PAINEL`, então só pode ser montada
# depois de o `.env` ser lido.
acrescentar_linha DATABASE_URL_PAINEL \
  "postgresql://fir_painel:${SENHA_PAINEL}@postgres:5432/fir"

# Mesma armadilha, mesma saída: DATABASE_URL_CARTEIRA e DATABASE_URL_PORTAL
# precisam existir no .env ANTES de qualquer comando do Compose, porque o
# Compose interpola o arquivo INTEIRO antes de decidir o que subir — inclusive
# `docker compose up -d postgres redis`. Os papéis fir_carteira/fir_portal só
# são CRIADOS depois (provisionar-carteira.sh / provisionar-portal.sh), mas a
# URL pode e deve ser escrita agora: ela só referencia a senha, não exige que
# o papel já exista no Postgres.
acrescentar_linha DATABASE_URL_CARTEIRA \
  "postgresql://fir_carteira:${SENHA_CARTEIRA}@postgres:5432/fir"
acrescentar_linha DATABASE_URL_PORTAL \
  "postgresql://fir_portal:${SENHA_PORTAL}@postgres:5432/fir"
# O papel das integrações (0092), mesma armadilha: a URL antes do Compose.
acrescentar_linha DATABASE_URL_INTEGRACOES \
  "postgresql://fir_integracoes:${SENHA_INTEGRACOES}@postgres:5432/fir"

set -a
# shellcheck disable=SC1090
. "./$AMBIENTE"
set +a

: "${DOMINIO:?DOMINIO não está no .env}"

# ---------------------------------------------------------------------------
# 1.5 · o envio de e-mail é OPT-IN (ADR 2026-11-17-saida-de-email-da-api)
# ---------------------------------------------------------------------------
# A rede `saida-email` mora em `docker-compose.email.yml`, e ele só entra com
# `SMTP_HOST` preenchido. Sem isso, a API fica só na `dados`, sem rota de
# saída — a postura de antes do acesso por e-mail, e a 7.6b mede exatamente
# ela.
#
# `COMPOSE_FILE` exportado AQUI, antes do primeiro comando do Compose, vale
# para todo `docker compose` deste script e dos `provisionar-*.sh` que ele
# chama. Ele é decidido pelo `.env` a cada execução — sobrescreve um
# `COMPOSE_FILE` que o `.env` tenha — para o deploy nunca discordar de
# `SMTP_HOST`. Ligar → desligar também funciona: sem o override, o `up -d`
# recria a `api` só na `dados` (a rede `fir_saida-email` fica órfã e vazia).
compose_file_do_env=${COMPOSE_FILE:-}
# `:` já é o separador no Linux; explícito para não depender do sistema (no
# Windows o padrão é `;`, e a lista viraria um nome de arquivo só).
export COMPOSE_PATH_SEPARATOR=:
if [ -n "${SMTP_HOST:-}" ]; then
  export COMPOSE_FILE=docker-compose.yml:docker-compose.email.yml
  ENVIO_EMAIL=ligado
  echo "==> envio de e-mail LIGADO: a API entra na 'saida-email' (só 465, se a regra estiver aplicada)"
else
  export COMPOSE_FILE=docker-compose.yml
  ENVIO_EMAIL=desligado
  echo "==> envio de e-mail desligado: a API fica sem rota de saída"
fi
# Um `COMPOSE_FILE` no `.env` que discorda é o que um `docker compose` digitado
# à mão vai usar — e ele recriaria a `api` com as redes erradas. Aviso, não
# erro: o deploy em si usa o valor decidido acima.
if [ -n "$compose_file_do_env" ] && [ "$compose_file_do_env" != "$COMPOSE_FILE" ]; then
  echo "  ATENÇÃO: o .env tem COMPOSE_FILE=$compose_file_do_env, mas o envio está $ENVIO_EMAIL." >&2
  echo "  Comandos do Compose à mão vão discordar do deploy. Ver README, 'Ligar o envio de e-mail'." >&2
fi

# ---------------------------------------------------------------------------
# 2 · a guarda da allowlist do painel
# ---------------------------------------------------------------------------
# **Falhar aqui é barato; falhar no Traefik é falhar aberto.**
#
# Um `sourceRange` vazio ou com CIDR malformado impede o Traefik de construir o
# middleware, e um roteador cuja cadeia de middlewares falhou **não entra na
# árvore de roteamento** — ele não passa a bloquear, deixa de existir. A
# negação na regra do roteador do produto (ver o compose) contém isso: o painel
# vira 404 em vez de ficar aberto. Esta guarda é a segunda camada, e é a que
# diz **por que**, em vez de devolver um 404 que ninguém sabe ler.
#
# Um IP nu — `203.0.113.7` sem `/32` — é o erro mais comum e é recusado aqui: o
# Traefik também o recusaria, e três linhas de shell no lugar certo poupam a
# viagem.
IPS_DO_PAINEL=${IPS_DO_PAINEL:-127.0.0.1/32}
# **IPv4 e IPv6.** A primeira versão só aceitava IPv4, e o deploy recusou
# `0.0.0.0/0,::/0` — a forma de abrir o painel que o próprio script diz, vinte
# linhas abaixo, que não vai recusar. Medido em produção, no dia em que o dono
# pediu para abrir o painel para a PO testar: o deploy parou no passo 2 e a
# mensagem acusava de inválida uma lista que estava certa.
#
# Abrir para a internet exige as DUAS famílias: o Traefik atende em IPv6 e um
# `0.0.0.0/0` sozinho deixaria de fora quem chega por IPv6 — que num celular em
# rede móvel é o caminho comum. Uma allowlist que bloqueia metade dos clientes
# ao ser "aberta" é o meio-caminho que ninguém depura, porque funciona na
# máquina de quem testou.
cidr4='[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}'
cidr6='[0-9A-Fa-f:]+/[0-9]{1,3}'
if ! printf '%s' "$IPS_DO_PAINEL" \
   | grep -Eq "^($cidr4|$cidr6)(,($cidr4|$cidr6))*$"; then
  echo "ERRO: IPS_DO_PAINEL não é uma lista de CIDRs válida: '$IPS_DO_PAINEL'" >&2
  echo "      Formato: 203.0.113.7/32  ou  203.0.113.7/32,198.51.100.0/24" >&2
  echo "      Aberto para todos, deliberadamente: 0.0.0.0/0,::/0" >&2
  echo "      Para fechar o painel para todos: 127.0.0.1/32" >&2
  exit 1
fi
# Faixa larga demais é o erro que **passa no aceite e não filtra nada** — e ele
# tem um caminho conhecido: o operador vê 403 onde esperava 200, conclui que "o
# IP não está chegando", e alarga a faixa até funcionar. `10.0.0.0/8` libera os
# vizinhos; `0.0.0.0/0` libera a internet.
#
# Não recusamos: `0.0.0.0/0` é um desligamento deliberado de rollback, e um
# script que impede o rollback é pior que o risco. Avisamos alto.
for faixa in ${IPS_DO_PAINEL//,/ }; do
  prefixo=${faixa#*/}
  if [ "$prefixo" -lt 24 ] 2>/dev/null; then
    echo "  ATENÇÃO: $faixa é uma faixa larga (/$prefixo)." >&2
    echo "  Se você chegou a ela porque o teste dava 403, o problema não era a" >&2
    echo "  faixa: confira se o IP do cliente chega ao Traefik. Uma allowlist" >&2
    echo "  que passa no aceite e não filtra nada é pior do que nenhuma." >&2
  fi
done
echo "==> allowlist do painel: $IPS_DO_PAINEL"

# ---------------------------------------------------------------------------
# 2.5 · as imagens — construídas AQUI, e conferidas pelo selo do commit
# ---------------------------------------------------------------------------
# **Duas versões disto recusaram deploys corretos. Esta é a terceira, e ela
# remove a pergunta em vez de respondê-la melhor.**
#
# O problema original: este script não construía imagem. O README mandava
# construir antes, em dois comandos, e quem rodava só o segundo via as oito
# asserções passarem, lia "FIR em https://…" e ia embora — com o container
# servindo a imagem anterior. O `docker compose up` imprime `Running` em vez de
# `Started`, numa linha que ninguém lê como erro porque não é erro.
#
# A primeira guarda comparou o `Created` da imagem com a data do commit.
# Recusou um deploy correto: o commit mexia só na API, o build do `web` ficou
# inteiro em cache, e **imagem reaproveitada preserva o `Created` antigo**.
#
# A segunda comparou por app, com os caminhos de entrada de cada um. Recusou
# outro deploy correto: o commit mexia em `turbo.json` — que É entrada do build
# — sem mudar nada que entre na imagem. Cache de novo, timestamp velho de novo.
#
# A lição é que **timestamp é a pergunta errada**. O que se quer saber não é
# "a imagem é recente", é "a imagem é DESTE código" — e isso é identidade.
# Cada Dockerfile recebe `ARG FIR_COMMIT` e grava `LABEL fir.commit`; o `ARG`
# muda a cada commit, então só a última camada é reconstruída e o resto vem do
# cache.
#
# E construir aqui acaba com a classe inteira de defeito: não há mais "você
# lembrou de construir?". `nice -n 19` porque o build compete com o Chatwoot e
# o WhatsApp de clientes de OUTROS negócios na mesma máquina.
COMMIT=$(git -C ../.. rev-parse HEAD 2>/dev/null || echo '')

if [ -n "$COMMIT" ]; then
  echo "==> construindo as imagens de ${COMMIT:0:7}"
  for app in api web; do
    nice -n 19 docker build \
      --build-arg "FIR_COMMIT=$COMMIT" \
      -f "../../apps/$app/Dockerfile" \
      -t "fir/$app:mais-recente" ../.. >/dev/null
  done

  # A conferência, DEPOIS do build: o selo da imagem é o commit do disco.
  # Falhar aqui significa que o build não produziu o que se pediu — e aí
  # seguir para o `compose up` seria subir código que ninguém escolheu.
  for app in api web; do
    selo=$(docker image inspect "fir/$app:mais-recente" \
             --format '{{index .Config.Labels "fir.commit"}}' 2>/dev/null || echo '')
    if [ "$selo" != "$COMMIT" ]; then
      echo "ERRO: fir/$app:mais-recente não é deste commit." >&2
      echo "      selo da imagem: ${selo:-<ausente>}" >&2
      echo "      commit no disco: $COMMIT" >&2
      echo "      O build acima não produziu o que se pediu. Não vou subir." >&2
      exit 1
    fi
  done
  echo "==> imagens seladas com ${COMMIT:0:7}"
else
  # Sem repositório git não há commit para selar. Acontece em cópia por
  # tarball; avisar e seguir é certo, porque recusar o deploy por falta de
  # histórico seria pior que o risco.
  echo "==> sem repositório git aqui; usando as imagens que já existem"
  for app in api web; do
    docker image inspect "fir/$app:mais-recente" >/dev/null 2>&1 || {
      echo "ERRO: a imagem fir/$app:mais-recente não existe e não há git para construí-la." >&2
      exit 1
    }
  done
fi

# ---------------------------------------------------------------------------
# 3 · dados
# ---------------------------------------------------------------------------
# O `10-papeis.sh` roda **aqui**, uma vez, na criação do volume, e é ele que
# cria `fir_migrate` e `fir_app` com as senhas do `.env`. Se o volume já
# existir, o Postgres o ignora — que é o certo: reexecutar trocaria a senha de
# papéis em uso.
echo "==> subindo Postgres e Redis"
docker compose up -d postgres redis

echo "==> esperando ficarem saudáveis"
saudaveis=0
for _ in $(seq 1 60); do
  saudaveis=$(docker compose ps --format '{{.Service}} {{.Health}}' \
              | grep -c 'healthy' || true)
  [ "$saudaveis" -ge 2 ] && break
  sleep 3
done
if [ "$saudaveis" -lt 2 ]; then
  echo "ERRO: Postgres ou Redis não ficaram saudáveis." >&2
  docker compose logs --tail 40 postgres redis >&2
  exit 1
fi

# A asserção que o healthcheck não faz: os papéis existem. Se o volume foi
# criado numa execução anterior SEM as senhas no ambiente, o `10-papeis.sh` não
# rodou e as migrations falhariam mais adiante com "password authentication
# failed" — mensagem que manda procurar no lugar errado.
papeis=$(docker compose exec -T -e PGPASSWORD="$SENHA_POSTGRES" postgres \
  psql --username fir --dbname fir -tAc \
  "SELECT count(*) FROM pg_roles WHERE rolname IN ('fir_migrate','fir_app')" | tr -d '[:space:]')
if [ "${papeis:-0}" -ne 2 ]; then
  echo "ERRO: fir_migrate e/ou fir_app não existem (encontrados: ${papeis:-0})." >&2
  echo "  O 10-papeis.sh roda UMA VEZ, na criação do volume. Se o volume" >&2
  echo "  'fir_postgres-dados' foi criado antes de o .env existir, ele não" >&2
  echo "  rodou. Ver infra/producao/README.md." >&2
  exit 1
fi
echo "  ok  fir_migrate e fir_app existem"

# ---------------------------------------------------------------------------
# 4 · o papel do painel
# ---------------------------------------------------------------------------
# Não é migration, e o cabeçalho de `provisionar-painel.sh` diz as duas razões:
# `fir_migrate` não tem CREATEROLE, e uma migration com senha dentro fica no
# repositório para sempre. Ele é idempotente e REBAIXA o papel a cada execução
# — se alguém deu BYPASSRLS "para depurar", isto desfaz.
#
# `bash provisionar-painel.sh`, e **não** `./provisionar-painel.sh`: os scripts
# desta pasta foram commitados com modo `100644`, porque quem os escreveu
# trabalha no Windows e o `rwxr-xr-x` que o Git Bash mostra ali é emulado. Num
# clone em Linux — que é todo deploy — `./` falha com `Permission denied`.
#
# O modo no índice do git foi corrigido junto desta linha, mas a invocação por
# `bash` fica: ela não depende de um bit que um `zip`, um `rsync` sem `-p` ou um
# checkout em outro sistema de arquivos pode perder de novo. O deploy não é o
# lugar de descobrir isso.
echo "==> provisionando fir_painel"
bash provisionar-painel.sh

echo "==> provisionando fir_carteira"
bash provisionar-carteira.sh

echo "==> provisionando fir_portal"
bash provisionar-portal.sh

echo "==> provisionando fir_integracoes"
bash provisionar-integracoes.sh

# ---------------------------------------------------------------------------
# 5 · migrations
# ---------------------------------------------------------------------------
# Container descartável, na rede dos dados, com a imagem da API — as migrations
# viajam **dentro** dela, para que nunca se aplique migration de uma versão
# diferente da que vai rodar.
#
# Como `fir_migrate`, nunca como superusuário: rodar migration com
# superusuário faz tudo passar, e passar assim esconde os erros de permissão
# que aparecem só no primeiro deploy. A `0013` CONFERE o papel do painel e para
# se ele estiver errado.
echo "==> aplicando migrations"
docker compose run --rm --no-deps \
  -e DATABASE_URL_MIGRATE="postgresql://fir_migrate:${SENHA_MIGRATE}@postgres:5432/fir" \
  --entrypoint node api migrar.js

# ---------------------------------------------------------------------------
# 6 · aplicação
# ---------------------------------------------------------------------------
# O `worker-agenda` é listado por nome, como os outros: um `up -d` sem nomes
# também o subiria, mas aqui a lista é o inventário do que o deploy entrega.
# Ele usa a imagem `fir/api`, então o selo conferido no passo 2.5 já cobre o
# código dele — não há segunda imagem para selar.
# Os três da carteira (D13) entram pela mesma razão: estavam só em dev.
WORKERS="worker-agenda worker-uso-diario worker-cobrancas worker-rotinas-internas"
# Os anexos (G8 4C): o worker da varredura e o antivírus. O antivírus sobe
# antes e o deploy NÃO espera por ele — a primeira subida baixa ~300 MB de
# assinaturas; até lá os anexos ficam `pendente`, que é falha fechada.
WORKERS="$WORKERS worker-anexos"
# As planilhas de indicadores (G8 4A). Sem `GOOGLE_SA_JSON` ele sobe assim mesmo
# e registra "não configurado" em cada leitura — não derruba o deploy.
WORKERS="$WORKERS worker-planilhas"
# As campanhas da FIR Clinic para a carteira (G8 1C/K4): rede `dados` só.
WORKERS="$WORKERS worker-campanhas"
echo "==> subindo o antivírus (clamav-atualizador, clamav)"
docker compose up -d clamav-atualizador clamav
echo "==> subindo API, web e workers ($WORKERS)"
docker compose up -d api web $WORKERS

# ---------------------------------------------------------------------------
# 7 · verificação
# ---------------------------------------------------------------------------
# **Um deploy que não é verificado não é um deploy.** Falha numa asserção é
# deploy RECUSADO, não aviso — com duas exceções marcadas, onde o que se mede
# depende de um Traefik que não é nosso e que demora alguns segundos para ver
# um container novo.
echo "==> verificando"

falhou=0

# 7.1 · a API responde, e o BANCO responde com ela.
# `/v1/saude` consulta o Postgres: um container "saudável" cujo banco caiu é
# pior que um container morto, porque continua recebendo tráfego.
esperar_api() {
  for _ in $(seq 1 40); do
    if docker compose exec -T api node -e \
      "fetch('http://127.0.0.1:4811/v1/saude').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))" \
      2>/dev/null; then return 0; fi
    sleep 3
  done
  return 1
}
if esperar_api; then
  echo "  ok  a API responde 200 em /v1/saude (o banco responde com ela)"
else
  echo "  ERRO: a API não respondeu em /v1/saude." >&2
  docker compose logs --tail 40 api >&2
  exit 1
fi

# 7.2 · sem sessão, a API RECUSA.
# Um 200 aqui significaria que o guard global caiu — e não há 200 "inofensivo"
# numa rota que devolve dado de clínica.
if docker compose exec -T api node -e \
  "fetch('http://127.0.0.1:4811/v1/eu').then(r=>process.exit(r.status===401?0:1)).catch(()=>process.exit(1))" \
  2>/dev/null; then
  echo "  ok  a API responde 401 em /v1/eu (sem sessão, como deve)"
else
  echo "  ERRO: /v1/eu não respondeu 401 sem sessão. NÃO libere este deploy." >&2
  falhou=1
fi

# 7.3 · o web alcança a API pela rede interna.
if docker compose exec -T web node -e \
  "fetch('http://api:4811/v1/saude').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))" \
  2>/dev/null; then
  echo "  ok  o web alcança a API pela rede interna"
else
  echo "  ERRO: o web não alcança a API." >&2
  falhou=1
fi

# 7.4 · O REWRITE DE `/api` FUNCIONA — a asserção que o Mavia não tinha.
#
# É a segunda das três armadilhas registradas lá: o destino do rewrite entra no
# manifesto de rotas no BUILD, e quando ele sai sem host **todas as telas
# servem 200 e `/api/*` devolve 404**. O deploy parecia bom e o produto não
# funcionava. Nenhuma das outras asserções pega isso: a API responde, o web
# alcança a API, o Traefik serve a página — e o login ainda assim não entra.
#
# Medir pelo web, na porta do web, é o único jeito de exercitar o manifesto.
if docker compose exec -T web node -e \
  "fetch('http://127.0.0.1:4810/api/v1/saude').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))" \
  2>/dev/null; then
  echo "  ok  o web repassa /api/* para a API (o rewrite tem host)"
else
  echo "  ERRO: /api/v1/saude pelo web não respondeu 200." >&2
  echo "  O destino do rewrite provavelmente saiu sem host no build." >&2
  echo "  Ver o ARG FIR_API_URL em apps/web/Dockerfile." >&2
  falhou=1
fi

# 7.5 · NENHUMA PORTA PUBLICADA NO HOST.
# A VPS roda a produção de outros negócios. Um `ports:` que escapou para o
# compose publicaria o Postgres do FIR na internet — e é o tipo de linha que
# entra "só para depurar" e fica.
publicadas=$(docker compose ps --format '{{.Service}} {{.Ports}}' | grep -E '0\.0\.0\.0|:::' || true)
if [ -z "$publicadas" ]; then
  echo "  ok  nenhum serviço do FIR publica porta no host"
else
  echo "  ERRO: há porta publicada no host:" >&2
  echo "$publicadas" >&2
  falhou=1
fi

# 7.6 · o Postgres NÃO tem rota de saída.
# A rede `dados` é `internal: true`, e o ponto é esse: um banco comprometido não
# tem por onde exfiltrar. Vale medir, porque `internal` é uma palavra num
# arquivo até alguém acrescentar uma segunda rede ao serviço.
if docker compose exec -T postgres getent hosts github.com >/dev/null 2>&1; then
  echo "  ERRO: o Postgres resolve nome externo — ele ganhou rota de saída." >&2
  falhou=1
else
  echo "  ok  o Postgres não tem rota de saída"
fi

# 7.6b · a rota de saída da API, nos dois modos do envio de e-mail (1.5).
#
# ESTRUTURA, sempre — as redes da `api` são exatamente as esperadas. O risco de
# sempre: alguém "resolver" um problema acrescentando `saida` ou `easypanel` à
# `api`, e o processo que serve o balcão passa a alcançar a internet ou
# serviço alheio. Diferente do esperado é ERRO.
#
# EGRESS, conforme o modo:
#
# - DESLIGADO (só `docker-compose.yml`): a API não tem rota NENHUMA, e a
#   medida é a de antes do acesso por e-mail — ela não resolve nome externo.
#   Resolver é ERRO.
# - LIGADO (com `docker-compose.email.yml`): a API resolve nomes (a
#   `saida-email` não é `internal`, e o DNS precisa passar para achar o SMTP),
#   então a medida passa a ser uma conexão TCP a github.com:443. Com a regra
#   de egress do README aplicada, ela morre no DROP; se conecta, a regra não
#   está lá, e o deploy é RECUSADO — o envio só liga com a regra.
#
# `node` e não `getent`/`nc`, para não depender de utilitário da imagem: se a
# ferramenta faltar, a asserção não pode passar por engano.
api_id=$(docker compose ps -q api || true)
# O prefixo das redes é o NOME DO PROJETO, não "fir" escrito à mão: na VPS o
# checkout renomeia o projeto (`name: firmaregestao`), e as redes de lá são
# `firmaregestao_dados`. Com o nome fixo, a asserção recusaria todo deploy.
projeto=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$api_id" 2>/dev/null || true)
projeto=${projeto:-fir}
if [ "$ENVIO_EMAIL" = ligado ]; then
  redes_esperadas="${projeto}_dados ${projeto}_saida-email "
else
  redes_esperadas="${projeto}_dados "
fi
redes_api=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$api_id" 2>/dev/null \
            | tr ' ' '\n' | sed '/^$/d' | sort | tr '\n' ' ' || true)
if [ "$redes_api" = "$redes_esperadas" ]; then
  echo "  ok  as redes da API são exatamente: ${redes_esperadas% }"
else
  echo "  ERRO: as redes da API são '${redes_api% }'; esperado '${redes_esperadas% }' (envio $ENVIO_EMAIL)." >&2
  echo "  Uma rede a mais na API é rota para a internet ou para serviço alheio." >&2
  falhou=1
fi

if [ "$ENVIO_EMAIL" = ligado ]; then
  if docker compose exec -T api node -e "
    const s = require('node:net').connect({ host: 'github.com', port: 443 });
    const fim = (c) => { s.destroy(); process.exit(c) };
    s.setTimeout(6000, () => fim(1));
    s.on('connect', () => fim(0));
    s.on('error', () => fim(1));" 2>/dev/null; then
    echo "  ERRO: a API alcança github.com:443 com o envio de e-mail LIGADO." >&2
    echo "  A regra de egress da 'saida-email' não está aplicada (ou se perdeu num" >&2
    echo "  reboot). Aplique-a (README, 'Ligar o envio de e-mail') ou esvazie SMTP_HOST." >&2
    falhou=1
  else
    echo "  ok  a API não alcança a internet fora da porta do SMTP"
  fi
else
  if docker compose exec -T api node -e \
    "require('node:dns').promises.lookup('github.com').then(()=>process.exit(0),()=>process.exit(1))" \
    2>/dev/null; then
    echo "  ERRO: a API resolve nome externo — ela ganhou rota de saída." >&2
    falhou=1
  else
    echo "  ok  a API não tem rota de saída"
  fi
fi

# 7.6c · os workers (agenda e os três da carteira) estão de pé, e não em laço de reinício.
#
# Ele não tem healthcheck (ver o compose), então `Up` no `ps` não basta: um
# processo que morre na inicialização — `DATABASE_URL` errada, migration que
# faltou — aparece como `Up 1 second` entre um reinício e outro. A medida é a
# contagem de reinícios não subir numa janela de 15 s.
#
# Falha aqui é deploy RECUSADO: o worker roda a mesma imagem da API, então um
# worker que não inicia costuma ser sintoma de algo que também morde a API.
declare -A reinicios_antes=()
for w in $WORKERS; do
  id=$(docker compose ps -q "$w" || true)
  reinicios_antes[$w]=$(docker inspect -f "{{.RestartCount}}" "$id" 2>/dev/null || echo x)
done
sleep 15
for w in $WORKERS; do
  id=$(docker compose ps -q "$w" || true)
  estado=$(docker inspect -f "{{.State.Status}} {{.RestartCount}}" "$id" 2>/dev/null || echo "ausente x")
  if [ "$estado" = "running ${reinicios_antes[$w]}" ]; then
    echo "  ok  $w está de pé (sem reinício em 15 s)"
  else
    echo "  ERRO: $w não está estável (estado/reinícios: $estado; antes: ${reinicios_antes[$w]})." >&2
    docker compose logs --tail 40 "$w" >&2
    falhou=1
  fi
done

# 7.6d · o worker-agenda TEM rota de saída — é a razão de ele existir.
# ATENÇÃO, não erro: o que se mede depende do DNS de fora da VPS, e a falha
# atrasa a sincronização da agenda sem derrubar o balcão. Mas é a única
# asserção que diz que a rede `saida` faz o que o compose promete.
if docker compose exec -T worker-agenda node -e \
  "require('node:dns').promises.lookup('calendar.google.com').then(()=>process.exit(0),()=>process.exit(1))" \
  2>/dev/null; then
  echo "  ok  o worker-agenda resolve nome externo (rede de saída funciona)"
else
  echo "  ATENÇÃO: o worker-agenda não resolve calendar.google.com." >&2
  echo "  A sincronização da agenda vai falhar. Confira a rede 'fir_saida'." >&2
fi

# 7.6e · o worker-planilhas alcança o Google Sheets (G8 4A). ATENÇÃO, não erro,
# pela mesma razão do 7.6d. Com a regra de egress do README aplicada, este é o
# teste de que ela deixou passar o que devia.
if docker compose exec -T worker-planilhas node -e \
  "require('node:dns').promises.lookup('sheets.googleapis.com').then(()=>process.exit(0),()=>process.exit(1))" \
  2>/dev/null; then
  echo "  ok  o worker-planilhas resolve sheets.googleapis.com"
else
  echo "  ATENÇÃO: o worker-planilhas não resolve sheets.googleapis.com." >&2
  echo "  A leitura das planilhas vai falhar. Confira a rede 'fir_saida-planilhas'." >&2
fi

# 7.6e' · a regra de egress da `saida-planilhas` está aplicada: o worker abre
# TCP com sheets.googleapis.com:443 e NÃO abre com github.com:80. ATENÇÃO, não
# erro, como o resto do 7.6d/e: sem a regra o worker lê as planilhas do mesmo
# jeito, e o que se perde é a segunda camada (ADR 2026-11-17-saida-das-planilhas).
# Mas é o único lugar que diz que a regra sumiu — reboot sem a unidade
# `<projeto>-egress.service`, ou alguém que esvaziou a DOCKER-USER.
# A 80 e não a 25: a 25 costuma ser bloqueada pelo provedor da VPS, e passaria
# com ou sem a nossa regra.
tcp_planilhas() {
  docker compose exec -T worker-planilhas node -e "
    const s = require('node:net').connect({ host: process.argv[1], port: Number(process.argv[2]) });
    const fim = (c) => { s.destroy(); process.exit(c) };
    s.setTimeout(6000, () => fim(1));
    s.on('connect', () => fim(0));
    s.on('error', () => fim(1));" "$1" "$2" 2>/dev/null
}
if tcp_planilhas github.com 80; then
  echo "  ATENÇÃO: o worker-planilhas alcança github.com:80 — a regra de egress da" >&2
  echo "  'saida-planilhas' não está aplicada (ou se perdeu). Rode" >&2
  echo "  'systemctl restart <projeto>-egress' (README, 'Regras de egress')." >&2
elif tcp_planilhas sheets.googleapis.com 443; then
  echo "  ok  o worker-planilhas só sai pela 443 (sheets.googleapis.com:443 abre, github.com:80 não)"
else
  echo "  ATENÇÃO: o worker-planilhas não abre TCP com sheets.googleapis.com:443." >&2
  echo "  A leitura das planilhas vai falhar. Confira a regra de egress (README)." >&2
fi

# 7.6f · com o envio ligado, a API alcança o SMTP do provedor.
# ATENÇÃO, não erro, pela razão do 7.6d: depende de fora da VPS, e um envio que
# falha não muda nada que o cliente veja (a rota responde igual; spec, appsec
# 13) — o que torna ESTA linha o único lugar em que a falha aparece no deploy.
# Só abre a conexão TCP: não autentica e não manda nada. Host e porta vêm do
# ambiente do próprio container, então nada do `.env` passa pela linha de
# comando.
if [ "$ENVIO_EMAIL" = desligado ]; then
  echo "  --  envio de e-mail desligado (SMTP_HOST vazio): criação de pessoa usa senha provisória"
else
  if [ "${SMTP_PORTA:-465}" != "465" ]; then
    echo "  ATENÇÃO: SMTP_PORTA=${SMTP_PORTA}, mas a regra de egress só libera a 465." >&2
  fi
  if docker compose exec -T api node -e "
    const s = require('node:net').connect({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORTA) });
    const fim = (c) => { s.destroy(); process.exit(c) };
    s.setTimeout(8000, () => fim(1));
    s.on('connect', () => fim(0));
    s.on('error', () => fim(1));" 2>/dev/null; then
    echo "  ok  a API alcança o SMTP do provedor (porta ${SMTP_PORTA:-465})"
  else
    echo "  ATENÇÃO: a API não alcança ${SMTP_HOST}:${SMTP_PORTA:-465}." >&2
    echo "  Convites e links de redefinição NÃO vão sair. Confira a rede" >&2
    echo "  'fir_saida-email' e a regra de egress (README)." >&2
  fi
fi

# 7.7 · o Traefik serve a página de entrada.
codigo=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: ${DOMINIO}" \
         --resolve "${DOMINIO}:443:127.0.0.1" "https://${DOMINIO}/entrar" || echo 000)
if [ "$codigo" = "200" ]; then
  echo "  ok  o Traefik serve https://${DOMINIO}/entrar"
else
  echo "  ATENÇÃO: o Traefik devolveu $codigo em /entrar." >&2
  echo "  O Traefik demora alguns segundos para ver um container novo." >&2
  echo "  Confira com: docker logs \$(docker ps -qf name=easypanel-traefik)" >&2
fi

# 7.8 · a allowlist do painel.
#
# Roda a partir do host da VPS, que **não** está na lista — uma conexão do host
# chega ao container com o endereço do gateway, não com `127.0.0.1`. Então o
# esperado aqui é recusa.
#
# Os três resultados possíveis significam coisas diferentes, e colapsá-los num
# "ok/erro" esconderia justamente a falha que importa.
codigo_painel=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: ${DOMINIO}" \
                --resolve "${DOMINIO}:443:127.0.0.1" "https://${DOMINIO}/superadmin" || echo 000)
case "$codigo_painel" in
  403)
    echo "  ok  o painel recusa origem fora da allowlist (403 do Traefik)"
    ;;
  404)
    echo "  ATENÇÃO: /superadmin devolveu 404." >&2
    echo "  O roteador do painel não está na árvore — provavelmente o middleware" >&2
    echo "  não pôde ser construído. Está FECHADO, que é o modo de falha certo," >&2
    echo "  mas o painel não sobe assim. Confira IPS_DO_PAINEL e os logs do Traefik." >&2
    ;;
  200)
    # D-24 (2026-11-08): o dono manteve o painel aberto a qualquer origem e
    # registrou o risco como aceito. Só nesse caso EXPLÍCITO — a allowlist
    # escrita como "tudo" (0.0.0.0/0) — o 200 vira aviso. Qualquer outra lista
    # que deixe passar origem de fora continua sendo erro: aí o controle
    # existe e falhou, que é o defeito que esta asserção pega.
    case ",$IPS_DO_PAINEL," in
      *,0.0.0.0/0,*)
        echo "  ATENÇÃO: /superadmin aberto a qualquer origem (IPS_DO_PAINEL=$IPS_DO_PAINEL)." >&2
        echo "  Risco aceito pelo dono na D-24 (docs/decisoes.md). Para fechar, ponha os IPs" >&2
        echo "  da Firmare em IPS_DO_PAINEL e rode este script de novo." >&2
        ;;
      *)
        echo "  ERRO: /superadmin respondeu 200 de uma origem fora da allowlist." >&2
        echo "  O controle da D-5 restrição 6 NÃO está no ar." >&2
        falhou=1
        ;;
    esac
    ;;
  *)
    echo "  ATENÇÃO: /superadmin devolveu $codigo_painel; esperado 403." >&2
    ;;
esac

if [ "$falhou" -ne 0 ]; then
  echo >&2
  echo "DEPLOY RECUSADO: uma ou mais asserções falharam." >&2
  echo "Os containers estão de pé, mas NÃO entregue este endereço a ninguém" >&2
  echo "antes de a falha estar resolvida." >&2
  exit 1
fi

echo
echo "FIR em https://${DOMINIO}"
echo "Segredos em $(pwd)/$AMBIENTE — modo 600, fora do repositório."
echo
echo "O PRIMEIRO OPERADOR do painel ainda não existe. Crie-o com:"
echo "  bash redefinir-superadmin.sh <usuario> \"Nome Completo\""
echo "Ele imprime a senha UMA VEZ, e por isso não está neste script."

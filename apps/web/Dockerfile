# A imagem do web — o único serviço que encara a internet.
#
# Mesma estrutura da API: dependências numa camada própria, build num sistema
# de arquivos limpo, runtime com o mínimo. Ver `apps/api/Dockerfile` para por
# que o build não acontece na máquina de quem faz o deploy.

# ---------------------------------------------------------------------------
# 1 · dependências
# ---------------------------------------------------------------------------
FROM node:22-slim AS deps
WORKDIR /repo

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json            apps/api/
COPY apps/web/package.json            apps/web/
COPY packages/domain/package.json     packages/domain/
COPY packages/contracts/package.json  packages/contracts/
COPY packages/ui/package.json         packages/ui/
COPY teste/package.json               teste/

RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# 2 · build
# ---------------------------------------------------------------------------
FROM deps AS build
WORKDIR /repo

COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web

# O build de um produto que lida com dado de saúde não manda estatística de uso
# para fora durante o deploy.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# O destino do `rewrite` de `/api` entra no manifesto de rotas **aqui**, no
# build — não é lido do ambiente do container. Com `NODE_ENV=production` o
# padrão do `next.config.mjs` já aponta para `http://api:4811`, o nome do
# serviço na rede interna do compose.
#
# **O `ARG` tem valor padrão, e isso não é estilo.** Um `ARG` declarado vazio
# que ninguém passa vira variável de ambiente com string vazia durante o
# `RUN` — a segunda das três armadilhas do deploy do Mavia. Com um padrão
# escrito aqui, a variável nunca chega vazia ao `next build`, e o modo de falha
# "todas as telas servem 200 e `/api/*` dá 404" não tem como acontecer.
#
# Ele existe para o dia em que a topologia mudar, e é o que ele de fato é: um
# argumento de **build**.
ARG FIR_API_URL=http://api:4811

RUN pnpm --filter @fir/web build

# ---------------------------------------------------------------------------
# 3 · runtime
# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# UTC no processo; a conversão para o fuso **da clínica** é do domínio
# (CLAUDE.md regra 22). No web isso importa duas vezes: o servidor renderiza
# data, e o navegador também.
ENV TZ=UTC
ENV PORT=4810
# Todas as interfaces **do container** — rede privada, sem porta publicada no
# host. Sem isto o Next liga em `localhost` e o Traefik não o alcança, com um
# 502 que não explica nada.
ENV HOSTNAME=0.0.0.0

# O `standalone` do Next: um servidor com só o que a aplicação alcança de fato.
# Os três diretórios são o que ele exige, e cada um vem de um lugar diferente
# do build — trocar a ordem ou o destino quebra em runtime, não no build.
COPY --from=build /repo/apps/web/.next/standalone/ ./
COPY --from=build /repo/apps/web/.next/static/ ./apps/web/.next/static/

# **Sem `public/`, e é diferença deliberada em relação ao molde do Mavia.**
# Este app não tem esse diretório: as fontes vêm do Google e não há imagem
# estática. Um `COPY` de diretório inexistente não é inofensivo — ele falha o
# build, e a mensagem manda procurar um erro de caminho que não existe. No dia
# em que entrar um favicon, esta linha volta.

# **Não roda como root.** Limita o dano de um RCE no único processo que a
# internet alcança.
USER node

EXPOSE 4810

# O `standalone` emite o servidor no caminho do app dentro do monorepo, e não
# na raiz — consequência de `outputFileTracingRoot` apontar para a raiz do
# workspace, que é o que faz `packages/` entrar no rastreamento.
# ---------------------------------------------------------------------------
# O SELO DO COMMIT
# ---------------------------------------------------------------------------
# **Por que a imagem carrega o commit, e por que isso substituiu uma
# comparação de datas.** O `implantar.sh` precisa saber se a imagem é do código
# que está no disco. A primeira tentativa comparou o `Created` da imagem com a
# data do commit, e **recusou dois deploys corretos**: quando um commit não
# muda as entradas de um app, o Docker reaproveita a imagem e **preserva o
# `Created` antigo` — a imagem está certa e a data diz que está velha.
#
# Identidade não tem esse problema. O `ARG` muda a cada commit, então esta
# última camada (e só ela) é reconstruída; o resto vem do cache. O selo diz a
# verdade sobre de onde a imagem veio, e o deploy compara uma coisa com ela
# mesma em vez de inferir de um relógio.
ARG FIR_COMMIT=desconhecido
LABEL fir.commit=$FIR_COMMIT

CMD ["node", "apps/web/server.js"]

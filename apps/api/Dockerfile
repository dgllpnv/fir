# A imagem da API.
#
# **O build acontece aqui, e não na máquina de quem faz o deploy.** Não é
# preferência: é a primeira das três armadilhas registradas no deploy do Mavia,
# onde uma extensão de editor instalada no ambiente do desenvolvedor entrou no
# grafo do bundler e quase foi para dentro do artefato. Um artefato que depende
# de quais extensões alguém tem instaladas não é reproduzível, e "compilou na
# minha máquina" deixa de significar qualquer coisa.
#
# Debian `slim`, e não Alpine: `@node-rs/argon2` é binário nativo, e a
# diferença entre glibc e musl é o tipo de problema que aparece na primeira
# tentativa de login em produção. Alguns megabytes a mais valem menos que essa
# certeza.

# ---------------------------------------------------------------------------
# 1 · dependências — a camada que o cache guarda
# ---------------------------------------------------------------------------
FROM node:22-slim AS deps
WORKDIR /repo

RUN corepack enable

# **Só os manifestos, antes do código.** É o que faz uma mudança em `.ts` não
# reinstalar o mundo: o Docker só invalida esta camada quando um `package.json`
# ou o lockfile muda de verdade.
#
# `teste/` entra porque é um pacote do workspace (ver `pnpm-workspace.yaml`): o
# `--frozen-lockfile` compara o lockfile com **todos** os manifestos, e a
# ausência de um deles faz a instalação falhar dizendo que o lockfile está
# desatualizado — mensagem que manda procurar no lugar errado.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json            apps/api/
COPY apps/web/package.json            apps/web/
COPY packages/domain/package.json     packages/domain/
COPY packages/contracts/package.json  packages/contracts/
COPY packages/ui/package.json         packages/ui/
COPY teste/package.json               teste/

# `--frozen-lockfile`: se o lockfile não corresponder aos manifestos, o build
# **falha** em vez de resolver versões novas por conta própria. Um deploy que
# instala uma versão diferente da testada é um deploy que não foi testado.
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# 2 · build — o bundle
# ---------------------------------------------------------------------------
FROM deps AS build
WORKDIR /repo

COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api

# O bundle resolve `@fir/domain` e `@fir/contracts` em tempo de build.
# Ver `apps/api/construir.mjs` para por que não é `tsc`.
RUN node apps/api/construir.mjs

# **A verificação que este build existe para garantir.** Se instrumentação de
# editor tiver entrado no artefato, o deploy para aqui.
#
# Os três marcadores são específicos de propósito. A versão equivalente no
# Mavia começou incluindo `buildHook`, que casou com código legítimo de
# dependência e reprovou um artefato limpo — e uma verificação que dá falso
# positivo é desligada por quem tem pressa, e aí deixa de verificar coisa
# alguma.
RUN set -eu; \
    for proibido in console-ninja wallabyjs .vscode; do \
      if grep -qF "$proibido" apps/api/dist/api.js apps/api/dist/migrar.js apps/api/dist/credencial.js apps/api/dist/migrar-clinica.js apps/api/dist/worker-agenda.js; then \
        echo "ERRO: '$proibido' entrou no artefato de producao." >&2; exit 1; \
      fi; \
    done; \
    echo "artefato limpo"

# O `node_modules` de produção, podado e sem links simbólicos, para o estágio
# final copiar. `hoisted` porque a imagem final não tem pnpm para resolver o
# store — ela só tem `node`.
#
# `--legacy` porque o pnpm 10+ só faz `deploy` de workspace com
# `inject-workspace-packages`, e ligar isso mudaria como **todo** o
# desenvolvimento resolve os pacotes internos por causa do deploy. O modo
# legado faz exatamente o que se quer aqui: resolver pelo lockfile e desmontar
# os links.
RUN pnpm --filter @fir/api --prod --legacy --config.node-linker=hoisted deploy /prod

# ---------------------------------------------------------------------------
# 3 · runtime — só o que roda
# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
# UTC no processo, sempre. A conversão para o fuso **da clínica** é do domínio
# (CLAUDE.md regra 22), e o fuso é propriedade da clínica, nunca global. Um
# container em outro fuso deslocaria a borda de todo dia civil — e as janelas
# de período são semiabertas em instantes UTC (regra 23).
ENV TZ=UTC
# Todas as interfaces **do container**, que é uma rede privada onde só o web
# entra — e nenhuma porta é publicada no host. Ligado em `127.0.0.1`, como no
# ambiente local, nem o web do lado alcançaria a API. Ver `src/main.ts`.
ENV HOST=0.0.0.0

# As dependências que ficam **fora** do bundle, por serem binário nativo ou por
# carregarem arquivo em runtime: `pg` e `@node-rs/argon2`.
#
# Vêm do `pnpm deploy`, feito no estágio de build: ele resolve **pelo
# lockfile**, poda as de desenvolvimento e desmonta os links simbólicos do
# store. Instalar aqui com `npm install pg` pegaria a última versão compatível
# do dia do build, e não a versão que a suíte de testes exercitou.
COPY --from=build /prod/node_modules ./node_modules
COPY --from=build /prod/package.json ./package.json

COPY --from=build /repo/apps/api/dist/ ./

# **As migrations viajam com a imagem.** Aplicar migration de uma versão
# diferente da que está rodando é a forma mais direta de quebrar produção.
#
# O caminho importa: `migrar.js` as procura em `<dir deste arquivo>/migrations`,
# e `dist/` foi copiado para a raiz de `/app` acima — então é aqui que elas
# precisam ficar.
COPY --from=build /repo/apps/api/migrations/ ./migrations/

# **Não roda como root.** O `node` da imagem oficial já tem um usuário `node`
# sem privilégio; usá-lo é gratuito, e é o que limita o dano de um RCE num
# processo que fala com banco de dado de saúde.
USER node

EXPOSE 4811

# `/v1/saude` verifica o **banco**, não só se o processo está de pé: um
# container "saudável" cujo Postgres caiu é pior que um container morto, porque
# continua recebendo tráfego. A rota é `@Publico()` justamente para isto.
#
# `node` e não `curl`: a imagem `slim` não tem curl, e instalá-lo só para o
# healthcheck acrescentaria superfície a um container de produção.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4811/v1/saude').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"

# Sem `--enable-source-maps`: o `sourcemap: 'inline'` do bundle já resolve, e a
# flag duplicaria o custo de memória — numa VPS compartilhada com a produção de
# outros negócios isso não é detalhe.
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

CMD ["node", "api.js"]

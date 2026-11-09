import { fileURLToPath } from 'node:url'
import { identificadorDeDeploy } from './identificador-de-deploy.mjs'

/**
 * O navegador chama `/api/...` na MESMA origem do web, e o servidor do Next
 * repassa para a API pela rede interna.
 *
 * Não é conveniência: é o que faz o cookie `__Host-fir-sessao` funcionar sem
 * CORS. `__Host-` proíbe `Domain`, então o cookie só vale na origem exata —
 * e uma API em outra origem simplesmente não o receberia. É também o que faz
 * a API **não ser publicada** em produção: só o `web` encara a internet.
 */
export default {
  reactStrictMode: true,

  /**
   * `standalone` — o que torna a imagem de produção viável.
   *
   * Sem isto, servir o Next exige o `node_modules` inteiro do monorepo dentro
   * da imagem: centenas de megabytes, com dependências de desenvolvimento e
   * binários nativos compilados para o sistema de quem construiu. Com
   * `standalone`, o Next emite um servidor com **só** o que a aplicação
   * alcança de fato, e a imagem final não precisa de pnpm nem de workspace.
   */
  output: 'standalone',

  /**
   * A raiz do monorepo, e não a do app. Sem isto o rastreamento de arquivos do
   * `standalone` para na pasta de `apps/web` e deixa fora `packages/domain`,
   * `contracts` e `ui` — que são justamente os que o `transpilePackages`
   * compila para dentro, e de onde vem todo o CSS (ver `globals.css`).
   *
   * `fileURLToPath`, e **não** `new URL(...).pathname`: o `pathname` de uma
   * URL `file://` vem percent-encodado e com barra inicial no Windows
   * (`/C:/Users/TI/Desktop/DEV/FIR%20-%20Rotina%20de%20Gest%C3%A3o/`). É o
   * mesmo defeito já registrado em `apps/api/src/main.ts`: o diretório deste
   * projeto tem espaço e "ã" no nome, e o caminho encodado não existe no
   * sistema de arquivos. O build de produção roda em Linux, mas um `next build`
   * na máquina de quem desenvolve é como se descobre isso cedo.
   */
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),

  transpilePackages: ['@fir/contracts', '@fir/domain', '@fir/ui'],

  /**
   * **Uma aba aberta antes do deploy recarrega inteira, em vez de navegar.**
   *
   * Sem isto, o JavaScript antigo que ficou na memória da aba navega por
   * dentro depois do deploy e monta telas com classes que o CSS novo não tem:
   * o dono viu o painel do superadmin desmontado por um instante, em
   * produção, depois de um deploy que reverteu uma mudança de tela (2026-11-09,
   * `docs/specs/correcoes-po-2026-11-09.md` C1). Com o `deploymentId`, o Next
   * compara a versão da aba com a do servidor a cada navegação e, se
   * divergirem, faz a navegação completa.
   *
   * O valor é o commit que o `implantar.sh` passa como `FIR_COMMIT`
   * (`apps/web/Dockerfile`). Fora do deploy ele não existe, e o build local
   * segue sem identificador — `||` pela mesma razão do `rewrites()` abaixo: um
   * `ARG` não passado chega como string vazia.
   */
  deploymentId: identificadorDeDeploy(process.env.FIR_COMMIT),

  /**
   * **A câmera só para este site, e nada de microfone nem localização.** O leitor
   * de código do estoque usa a câmera (A4); sem esta linha, qualquer `iframe` de
   * terceiro que um dia entrasse numa página herdaria o direito de pedi-la
   * (gate appsec S-18).
   */
  async headers() {
    return [
      {
        source: '/:caminho*',
        headers: [
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ]
  },

  experimental: {
    // `packages/ui` traz o CSS que o Next precisa processar, e ele vive **fora**
    // de `apps/web` — num workspace pnpm é um link simbólico para
    // `../../packages/ui`. Sem isto o carregador de CSS recusa o arquivo por
    // estar fora do diretório do app.
    externalDir: true,
  },

  async rewrites() {
    /**
     * **O destino é resolvido no BUILD, não em runtime.** `rewrites()` entra no
     * manifesto de rotas que o `next build` emite, então passar `FIR_API_URL`
     * ao container **não** tem efeito — o valor que vale é o do momento em que
     * a imagem foi construída. Ver o `ARG` no `apps/web/Dockerfile`.
     *
     * Daí o padrão depender de `NODE_ENV` em vez de exigir configuração:
     *
     * - em produção, `api` é o nome do serviço na rede interna do compose, e é
     *   sempre o endereço certo lá;
     * - fora dela, `127.0.0.1:4811` é sempre o endereço certo (bloco 48xx).
     *
     * As duas situações ficam corretas sem ninguém configurar nada. Antes
     * disto o padrão era `127.0.0.1:4811` sempre — e dentro do container do web
     * `127.0.0.1` é o próprio web, então `/api/*` responderia erro de conexão
     * enquanto todas as telas serviriam 200.
     */
    const padrao =
      process.env.NODE_ENV === 'production' ? 'http://api:4811' : 'http://127.0.0.1:4811'

    /**
     * **`||` e não `??`, e a diferença custou um deploy no Mavia.** Um `ARG` do
     * Docker que não é passado vira `ENV` com string **vazia**, não indefinida
     * — e o `??` só cai no padrão para `null` e `undefined`. O destino do
     * rewrite ficava `/:caminho*`, sem host, e `/api/...` respondia 404 em
     * produção enquanto todas as telas funcionavam. O teste de fumaça não
     * pegou porque ali o `--build-arg` era passado.
     */
    const api = process.env.FIR_API_URL || padrao

    return [{ source: '/api/:caminho*', destination: `${api}/:caminho*` }]
  },
}

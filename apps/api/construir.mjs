import { build } from 'esbuild'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Todos os caminhos daqui são relativos a **este arquivo**, e não ao diretório
 * de trabalho. O Dockerfile invoca `node apps/api/construir.mjs` da raiz do
 * repositório; um caminho relativo ao cwd funcionaria só quando invocado de
 * dentro de `apps/api`.
 */
const AQUI = dirname(fileURLToPath(import.meta.url))

/**
 * O build da API para produção.
 *
 * **Um bundle, e não `tsc`.** A razão é o monorepo: `packages/domain`,
 * `contracts` e `ui` publicam **TypeScript de origem**
 * (`"exports": "./src/index.ts"`), de propósito — é o que faz "ir à definição"
 * cair no código e não num `.d.ts`, e o que evita rebuild a cada mudança no
 * domínio. Compilar com `tsc` exigiria dar a cada pacote um `dist` e reescrever
 * os `exports`, trocando a ergonomia de desenvolvimento pela do deploy.
 *
 * O bundle resolve `@fir/domain` e `@fir/contracts` em tempo de build e emite
 * um arquivo. O container de produção não precisa de pnpm, de workspace, nem
 * de `node_modules` para o nosso próprio código.
 *
 * ## Por que isto funciona com o Nest
 *
 * O esbuild **não** emite `design:paramtypes`, e a injeção do Nest que depende
 * desse metadado é a que declara dependência só pelo **tipo** do parâmetro.
 * Este código não tem nenhuma: toda injeção usa `@Inject(TOKEN)` explícito —
 * ver o comentário no `SaudeController`, que registra que isso foi **medido**
 * e não suposto, porque o vitest e o `tsx` já rodam sobre esbuild. Ou seja: a
 * ausência desse metadado é a condição em que a suíte inteira já roda, e um
 * erro de DI apareceria na inicialização, não em produção.
 */

const externos = [
  // Binário nativo. Empacotar não faz sentido.
  '@node-rs/argon2',
  // Driver com carregamento dinâmico.
  'pg',
  'pg-native',
  // O Nest resolve pacotes opcionais por `require` condicional; deixá-los
  // externos evita que o esbuild tente resolver o que não instalamos.
  '@nestjs/microservices',
  '@nestjs/websockets',
  '@nestjs/platform-express',
  // Extras opcionais do adaptador Fastify. Servir arquivo estático e
  // renderizar template não são coisas que esta API faz — ela devolve JSON.
  //
  // Marcá-los externos não é cosmético, e o motivo está registrado como a
  // primeira das três armadilhas do deploy do Mavia: sem isso o esbuild
  // **sobe a árvore de diretórios** procurando por eles, sai do repositório e
  // chega na pasta de extensões do editor, onde encontra uma cópia embutida de
  // `consolidate`. O build passava a depender de quais extensões estão
  // instaladas na máquina, e o artefato de produção passava a carregar
  // instrumentação de editor.
  '@fastify/static',
  '@fastify/view',
  'class-transformer',
  'class-validator',
  'cache-manager',
  // Upload de arquivo. O `FastifyAdapter` do Nest 12 o carrega por
  // `loadPackage(..., () => import('@fastify/multipart'))`, e o esbuild resolve
  // esse `import()` dinâmico em tempo de build mesmo dentro de um carregador
  // condicional. Não está na lista equivalente do Mavia porque lá a versão do
  // adaptador não o referenciava — é a diferença que "adaptar, não copiar
  // cego" significa na prática. Esta API não recebe upload.
  '@fastify/multipart',
]

/**
 * NADA DE FORA DO REPOSITÓRIO ENTRA NO BUNDLE.
 *
 * Esta é a guarda que a primeira das três armadilhas do deploy do Mavia pede,
 * e ela foi escrita depois de o defeito **acontecer aqui**, nesta máquina: a
 * extensão Console Ninja havia **editado** `node_modules/@nestjs/core/index.js`
 * e injetado um bloco `/* build-hook-start *\/` com um `require` de caminho
 * ABSOLUTO para `C:\Users\<quem>\.vscode\extensions\...`. Não é o resolvedor
 * passeando: é uma dependência mutada no disco.
 *
 * Sem esta guarda, o sintoma é um muro de dezesseis erros pedindo para
 * resolver `velocityjs`, `haml-coffee`, `twing` e outros motores de template
 * que este produto nunca ouviu falar — porque o hook do editor embute uma
 * cópia do `consolidate`. Quem lê aquilo conclui que falta dependência e
 * começa a marcar nomes como externos, um por um, até o build "passar". Aí a
 * instrumentação do editor está **dentro** do artefato de produção, e o
 * artefato passa a depender de quais extensões alguém tem instaladas.
 *
 * Com a guarda, a mensagem diz o que é e o que fazer. E em Docker — onde o
 * build de verdade acontece, com `pnpm install --frozen-lockfile` sobre um
 * sistema de arquivos limpo — ela nunca dispara.
 *
 * A verificação no Dockerfile (o `grep` por `console-ninja`) continua
 * existindo, e as duas não são redundantes: esta recusa a ENTRADA, aquela
 * confere a SAÍDA. Uma guarda de entrada com uma lista de nomes a bloquear
 * erra por omissão; esta inverte o ônus — só o que está sob a raiz do
 * repositório pode entrar.
 */
const RAIZ = resolve(AQUI, '..', '..')

const soDentroDoRepositorio = {
  name: 'so-dentro-do-repositorio',
  // `construcao` e não `build`: o parâmetro sombrearia a função `build`
  // importada do esbuild, e um sombreamento dentro de um guarda de segurança
  // é a próxima armadilha.
  setup(construcao) {
    construcao.onLoad({ filter: /.*/ }, (args) => {
      // Comparação normalizada: no Windows a letra de unidade pode diferir em
      // caixa entre o que o resolvedor devolve e o que `resolve` produz.
      const dentro = (caminho) => {
        const a = resolve(caminho)
        const base = RAIZ.endsWith(sep) ? RAIZ : RAIZ + sep
        return process.platform === 'win32'
          ? a.toLowerCase().startsWith(base.toLowerCase())
          : a.startsWith(base)
      }
      if (dentro(args.path)) return null
      return {
        errors: [
          {
            text:
              `o build tentou carregar um arquivo de FORA do repositório:\n` +
              `    ${args.path}\n` +
              `Isso é instrumentação de editor no grafo do build (Console Ninja, ` +
              `Wallaby e afins editam node_modules e injetam um require de caminho ` +
              `absoluto). O artefato de produção NÃO pode depender disso.\n` +
              `Construa em Docker — é o que o deploy faz — ou reinstale as ` +
              `dependências com a extensão desligada.`,
          },
        ],
      }
    })
  },
}

const comum = {
  absWorkingDir: AQUI,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: externos,
  plugins: [soDentroDoRepositorio],
  // `inline` e não `external`: o mapa vai dentro do arquivo, e o rastro de
  // pilha de um 500 em produção aponta para a linha do fonte.
  sourcemap: 'inline',
  // Sem minificação: o ganho de tamanho não paga a perda de legibilidade do
  // rastro de pilha num produto que lida com dinheiro de clínica e com dose.
  minify: false,
  logLevel: 'info',
  /**
   * `require` em ESM empacotado.
   *
   * Algumas dependências do Nest usam `require` mesmo sob ESM. O `banner`
   * reconstrói o `require` a partir de `createRequire`, que é o caminho
   * oficial — sem isso o bundle quebra na primeira dependência que o usa.
   */
  banner: {
    js: [
      "import { createRequire as __criarRequire } from 'node:module'",
      'const require = __criarRequire(import.meta.url)',
    ].join('\n'),
  },
}

await build({
  ...comum,
  entryPoints: ['src/main.ts'],
  outfile: 'dist/api.js',
})

/**
 * O executor de migrations, num arquivo próprio.
 *
 * Ele **não** roda dentro do processo da API: migration é um passo do deploy,
 * com credencial diferente (`fir_migrate`, o único papel com `BYPASSRLS`).
 * Aplicá-la na inicialização faria dois containers subindo em paralelo
 * tentarem migrar ao mesmo tempo, e daria à API um papel que ela não deve ter.
 *
 * As migrations viajam **dentro da imagem** (ver o Dockerfile), e o `migrar.ts`
 * as procura em `dist/../migrations` relativo a si mesmo — por isso o
 * Dockerfile as copia ao lado deste arquivo.
 */
await build({
  ...comum,
  entryPoints: ['migrar.ts'],
  outfile: 'dist/migrar.js',
})

/**
 * O gerador de credencial do break-glass.
 *
 * Existe porque `redefinir-superadmin.sh` precisa de `gerarSenhaProvisoria` e
 * de `hashDeSenha` **dentro do container de produção**, e lá não há workspace:
 * a imagem tem um bundle e o `node_modules` das dependências externas, então
 * `import('@fir/domain')` não resolve. Sem este arquivo, a saída de emergência
 * do superadmin falharia justamente no dia em que fosse necessária.
 *
 * Ele é um ponto de entrada de **deploy**, nunca uma rota: nada na API o
 * importa.
 */
await build({
  ...comum,
  entryPoints: ['credencial.ts'],
  outfile: 'dist/credencial.js',
})

/**
 * O que **não** entra na imagem, e é decisão e não esquecimento:
 *
 * - `semear.ts` — a semente da clínica de demonstração tem a senha escrita
 *   nela (`quatro-pedras-no-caminho`). Numa imagem de produção isso é uma
 *   credencial conhecida a um `docker compose run` de distância, e a clínica
 *   de teste nasce pelo painel do superadmin, que é o caminho que queremos
 *   exercitar de verdade.
 * - `migrar-clinica.ts` — o corte das clínicas reais depende de decisões que o
 *   dono do produto ainda vai tomar com cada uma, e o ensaio dele roda contra
 *   cópia restaurada do backup, não contra a imagem que serve o produto.
 */

console.log('\nAPI construída em dist/ (api.js, migrar.js, credencial.js).')

import 'reflect-metadata'
import cookie from '@fastify/cookie'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppModule } from './app.module'
import { inteiroDoAmbiente } from './comum/ambiente'

export async function registrarCookie(app: NestFastifyApplication): Promise<void> {
  await app.register(cookie as never)
}

const PORTA = inteiroDoAmbiente('PORTA', 4811, { min: 1, max: 65_535 })
const HOST = process.env['HOST'] ?? '127.0.0.1'

/**
 * Quantos saltos de proxy confiar ao resolver o IP de origem.
 *
 * O limite de login por origem (`limite-por-origem.ts`) depende de `req.ip`,
 * e `req.ip` depende disto. Atrás do Traefik, `socket.remoteAddress` é o
 * endereço do proxy — todas as clínicas viram um IP só, e o limite por origem
 * passa a ser um limite global. O endereço real está no `X-Forwarded-For`,
 * que é uma LISTA: o Traefik APENDA o que viu, e a entrada mais à esquerda é
 * escrita pelo CLIENTE. Um cabeçalho que o cliente escreve não serve de
 * limite — ele inventaria um IP por requisição.
 *
 * `trustProxy` recebe a FUNÇÃO de confiança do `proxy-addr`, que o Fastify
 * chama para cada endereço da cadeia começando no salto 0 (o endereço do
 * socket) e caminhando para a esquerda do `X-Forwarded-For`. `req.ip` é o
 * primeiro endereço NÃO confiável encontrado — isto é, com `n` saltos
 * confiáveis, a entrada que o `n`-ésimo proxy confiável acrescentou. Com
 * Traefik na frente da API e mais nada, `n = 1`.
 *
 * A função, e não o número: a tipagem do Fastify 5 declara
 * `boolean | string | string[] | TrustProxyFunction` — `number` funciona em
 * tempo de execução mas não compila, e um `as` para contornar a tipagem
 * esconderia justamente a semântica que importa aqui.
 *
 * O padrão é **0 — não confiar em cabeçalho nenhum**, de propósito: confiar
 * por padrão faz um `X-Forwarded-For` forjado desligar o limite em silêncio,
 * e quem sabe quantos saltos existem é o operador que escreveu o compose. Em
 * produção, `PROXY_SALTOS_CONFIAVEIS=1` em `infra/producao`.
 */
const PROXY_SALTOS_CONFIAVEIS = inteiroDoAmbiente('PROXY_SALTOS_CONFIAVEIS', 0, { min: 0 })

export const confiarNoSalto = (_endereco: string, salto: number): boolean =>
  salto < PROXY_SALTOS_CONFIAVEIS

/**
 * `import.meta.url` contra `argv[1]`: o módulo é importado pelos testes, e lá
 * não se quer abrir porta nenhuma.
 *
 * NÃO é a comparação de string ingênua (`import.meta.url.endsWith(argv[1])`)
 * — medido diretamente nesta máquina: `import.meta.url` percent-encoda
 * espaço e acento (`FIR%20-%20Rotina%20de%20Gest%C3%A3o`), enquanto
 * `process.argv[1]` traz o caminho crú com espaço e "ã" literais. Com
 * `.replace(/\\/g, '/')` apenas, a comparação dá `false` sempre — o diretório
 * deste projeto tem espaço e "ã" no nome, então a API nunca subiria por
 * `pnpm --filter @fir/api dev` nem por `tsx watch`.
 *
 * `fileURLToPath` desfaz o percent-encoding e a URL `file://`; `resolve`
 * normaliza separador de caminho e barras duplicadas dos dois lados. Em
 * `win32`, letras de unidade podem diferir em caixa (`c:` vs `C:`) entre
 * quem chamou o processo e o valor devolvido por `fileURLToPath` — por isso
 * a comparação final ignora caixa só nesta plataforma.
 */
function ehPontoDeEntrada(argv1: string | undefined): boolean {
  if (!argv1) return false
  const atual = resolve(fileURLToPath(import.meta.url))
  const chamado = resolve(argv1)
  return process.platform === 'win32'
    ? atual.toLowerCase() === chamado.toLowerCase()
    : atual === chamado
}

if (ehPontoDeEntrada(process.argv[1])) {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: confiarNoSalto }),
  )
  await registrarCookie(app)
  await app.listen(PORTA, HOST)
  process.stdout.write(`API em http://${HOST}:${PORTA}\n`)
}

import 'reflect-metadata'
import cookie from '@fastify/cookie'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppModule } from './app.module'

export async function registrarCookie(app: NestFastifyApplication): Promise<void> {
  await app.register(cookie as never)
}

const PORTA = Number(process.env['PORTA'] ?? 4811)
const HOST = process.env['HOST'] ?? '127.0.0.1'

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
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter())
  await registrarCookie(app)
  await app.listen(PORTA, HOST)
  process.stdout.write(`API em http://${HOST}:${PORTA}\n`)
}

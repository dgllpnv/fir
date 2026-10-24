import 'reflect-metadata'
import { AppModule } from '@fir/api/app.module'
import { registrarCookie } from '@fir/api/main'
import { RequestMethod } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { MetadataScanner, ModulesContainer, NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ROTAS_PUBLICAS } from './registro'

/**
 * O teste que fecha a CLASSE "rota sem autenticação", do mesmo jeito que
 * `escrita-sem-rls.test.ts` fechou "tabela sem RLS".
 *
 * O buraco que ele tapa, achado na revisão final da branch: `SessaoGuard` era
 * aplicado rota a rota com `@UseGuards`, e `saude.controller.ts` — o
 * controlador mais curto do repositório, logo o mais copiado — não tinha
 * nenhum. Um `GET /v1/tarefas` escrito no Plano 2 a partir dele subiria **sem
 * autenticação**. O interceptor de redação falha fechado e apagaria os campos
 * monetários, então o sintoma seria "sumiu o valor", nunca "vazou o
 * paciente": nome, procedimento e dose sairiam inteiros para qualquer um na
 * internet. Nenhum dos quatro testes transversais quebrava — eles varrem o
 * catálogo do Postgres e os esquemas Zod, e nenhum varria as rotas do Nest.
 *
 * Por que varrer o CONTAINER do Nest e não uma lista escrita à mão: a lista
 * à mão é exatamente o que falha no endpoint número quarenta. Aqui a fonte da
 * verdade é o módulo de verdade, subido de verdade.
 *
 * Mecanismo, medido nesta máquina (ver o relatório da correção):
 * `ModulesContainer` dá os controladores registrados sem precisar importar o
 * `DiscoveryModule`; `MetadataScanner.getAllMethodNames` dá os handlers;
 * `PATH_METADATA`/`METHOD_METADATA` de `@nestjs/common/constants` dão caminho
 * e verbo. O `printRoutes` do adaptador Fastify também lista as rotas, mas
 * devolve TEXTO — não dá como voltar do texto ao handler para ler o
 * `@Publico()` dele, então ele serve de conferência e não de fonte.
 */

type RotaDescoberta = {
  readonly metodo: string
  readonly caminho: string
  readonly controlador: string
  readonly handler: string
  readonly publico: boolean
}

/** Mesma chave de `apps/api/src/autorizacao/publico.decorator.ts`. */
const PUBLICO = 'fir:publico'

const juntar = (...partes: (string | undefined)[]): string => {
  const limpo = partes
    .filter((p): p is string => typeof p === 'string')
    .flatMap((p) => p.split('/'))
    .filter((p) => p !== '')
  return `/${limpo.join('/')}`
}

let app: NestFastifyApplication
let rotas: RotaDescoberta[]

beforeAll(async () => {
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
  })
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  const scanner = new MetadataScanner()
  rotas = []
  for (const [, modulo] of app.get(ModulesContainer)) {
    for (const [, wrapper] of modulo.controllers) {
      const classe = wrapper.metatype
      const instancia = wrapper.instance
      // `metatype` é `Function | Type<object> | null` — provider dinâmico não
      // tem classe. `typeof === 'function'` estreita os três casos de uma vez
      // e dá acesso a `.name` sem `as`.
      if (typeof classe !== 'function' || instancia === null || typeof instancia !== 'object') {
        continue
      }

      const prefixo = Reflect.getMetadata(PATH_METADATA, classe) as string | undefined
      const publicoNaClasse = Reflect.getMetadata(PUBLICO, classe) === true
      const proto = Object.getPrototypeOf(instancia) as Record<string, unknown>

      for (const nome of scanner.getAllMethodNames(proto)) {
        const handler = proto[nome]
        if (typeof handler !== 'function') continue
        const verbo = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined
        const caminho = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined
        // Método que não é rota (auxiliar privado, ciclo de vida) não tem os
        // dois metadados — o Nest só os põe em quem tem @Get/@Post/etc.
        if (verbo === undefined || caminho === undefined) continue

        rotas.push({
          metodo: RequestMethod[verbo] ?? `DESCONHECIDO(${verbo})`,
          caminho: juntar(prefixo, caminho),
          controlador: classe.name,
          handler: nome,
          publico: publicoNaClasse || Reflect.getMetadata(PUBLICO, handler) === true,
        })
      }
    }
  }
})

afterAll(async () => {
  await app.close()
})

const chave = (r: { metodo: string; caminho: string }) => `${r.metodo} ${r.caminho}`

describe('toda rota do Nest está autenticada, ou é pública de propósito', () => {
  it('a varredura encontrou rotas — senão ela não verificou nada', () => {
    // Piso, igual ao de `escrita-sem-rls.test.ts`: um `ModulesContainer` que
    // mudou de forma numa atualização do Nest faria todos os testes abaixo
    // passarem varrendo uma lista vazia.
    expect(
      rotas.length,
      'nenhuma rota encontrada no AppModule — a varredura não verificou nada',
    ).toBeGreaterThan(0)
  })

  it('as rotas marcadas @Publico() são EXATAMENTE as do registro', () => {
    const marcadas = rotas.filter((r) => r.publico).map(chave).sort()
    const registradas = ROTAS_PUBLICAS.map(chave).sort()

    // Nos dois sentidos, e a mensagem nomeia método e caminho:
    //  - marcada e não registrada = alguém abriu uma rota sem ninguém ler;
    //  - registrada e não marcada = o registro mente, e o próximo leitor
    //    confia nele.
    const naoRegistradas = marcadas.filter((k) => !registradas.includes(k))
    expect(
      naoRegistradas,
      `rota(s) com @Publico() fora de ROTAS_PUBLICAS (teste/registro.ts): ${naoRegistradas.join(', ')}. ` +
        'Acrescente ao registro com a razão escrita, ou tire o @Publico().',
    ).toEqual([])

    const semMarca = registradas.filter((k) => !marcadas.includes(k))
    expect(
      semMarca,
      `ROTAS_PUBLICAS lista rota(s) que não existem ou não têm @Publico(): ${semMarca.join(', ')}.`,
    ).toEqual([])
  })

  it('TODA rota não-pública responde 401 sem cookie de sessão', async () => {
    const fastify = app.getHttpAdapter().getInstance()
    const protegidas = rotas.filter((r) => !r.publico)
    expect(
      protegidas.length,
      'nenhuma rota protegida encontrada — ou tudo virou @Publico(), ou a varredura quebrou',
    ).toBeGreaterThan(0)

    for (const rota of protegidas) {
      // Parâmetro de caminho vira um uuid qualquer: o guard roda ANTES do
      // handler e antes do parse do corpo, então o valor nunca é usado.
      const url = rota.caminho.replace(/:[^/]+/g, '00000000-0000-0000-0000-000000000000')
      const metodo = rota.metodo === 'ALL' ? 'GET' : rota.metodo
      const r = await fastify.inject({ method: metodo as 'GET', url, payload: {} })

      // Esta é a asserção que fecha a classe. Se ela falhar, existe uma rota
      // que responde sem sessão: ou ela devolve dado de clínica a quem não
      // entrou, ou ela precisa de `@Publico()` e de uma linha em
      // ROTAS_PUBLICAS com a razão.
      expect(
        r.statusCode,
        `${rota.metodo} ${rota.caminho} (${rota.controlador}.${rota.handler}) respondeu ` +
          `${r.statusCode} sem cookie de sessão, e não 401. Rota DESPROTEGIDA.`,
      ).toBe(401)
    }
  })
})

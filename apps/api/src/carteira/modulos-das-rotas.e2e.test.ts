import { RequestMethod } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { MetadataScanner, ModulesContainer, NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { registrarCookie } from '../main'
import { telaDaRota } from './modulos-das-rotas'
import { SO_USUARIO_DE_GESTAO } from './so-usuario-de-gestao.decorator'

/**
 * **G8 0.5 — toda rota de carteira tem TELA declarada** (appsec A-4, caso de
 * abuso 6). A lista vem do registro do Nest, subido de verdade — nunca de uma
 * lista escrita à mão, que é o que falha no endpoint número quarenta. Rota de
 * carteira sem linha em `modulos-das-rotas.ts` reprova a suíte (e, em
 * produção, o `CarteiraGuard` a recusa com 403: negação por padrão).
 */
const juntar = (...partes: (string | undefined)[]): string => {
  const limpo = partes
    .filter((p): p is string => typeof p === 'string')
    .flatMap((p) => p.split('/'))
    .filter((p) => p !== '')
  return `/${limpo.join('/')}`
}

let app: NestFastifyApplication
const rotas: { verbo: string; molde: string }[] = []

beforeAll(async () => {
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false })
  await registrarCookie(app)
  await app.init()
  const scanner = new MetadataScanner()
  for (const [, modulo] of app.get(ModulesContainer)) {
    for (const [, wrapper] of modulo.controllers) {
      const classe = wrapper.metatype
      const instancia = wrapper.instance
      if (typeof classe !== 'function' || instancia === null || typeof instancia !== 'object') continue
      const naClasse = Reflect.getMetadata(SO_USUARIO_DE_GESTAO, classe) === true
      const prefixo = Reflect.getMetadata(PATH_METADATA, classe) as string | undefined
      const proto = Object.getPrototypeOf(instancia) as Record<string, unknown>
      for (const nome of scanner.getAllMethodNames(proto)) {
        const handler = proto[nome]
        if (typeof handler !== 'function') continue
        const verbo = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined
        const caminho = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined
        if (verbo === undefined || caminho === undefined) continue
        if (!naClasse && Reflect.getMetadata(SO_USUARIO_DE_GESTAO, handler) !== true) continue
        rotas.push({ verbo: RequestMethod[verbo] ?? '?', molde: juntar(prefixo, caminho) })
      }
    }
  }
})

afterAll(async () => {
  await app.close()
})

describe('toda rota de carteira declara a tela (A-4)', () => {
  it('a varredura achou as rotas da carteira (piso: não varreu uma lista vazia)', () => {
    expect(rotas.length).toBeGreaterThan(50)
  })

  it('nenhuma rota `@SoUsuarioDeGestao` fica sem tela', () => {
    const semTela = rotas.filter((r) => telaDaRota(r.verbo, r.molde) === null).map((r) => `${r.verbo} ${r.molde}`)
    expect(semTela, `rota(s) de carteira sem tela em modulos-das-rotas.ts: ${semTela.join(', ')}`).toEqual([])
  })

  it('o painel do mês e as baixas são `mensalidades` (exige valores); a lista da ficha é `clientes`', () => {
    expect(telaDaRota('GET', '/v1/carteira/cobrancas/painel')).toBe('mensalidades')
    expect(telaDaRota('POST', '/v1/carteira/cobrancas/:id/marcar-pago')).toBe('mensalidades')
    expect(telaDaRota('GET', '/v1/carteira/cobrancas')).toBe('clientes')
    expect(telaDaRota('GET', '/v1/carteira/rota-que-nao-existe')).toBeNull()
  })

  it('D-25: os roteiros de abordagem seguem a Prospecção; modelos e configuração continuam no Método', () => {
    expect(telaDaRota('GET', '/v1/carteira/mensagens/roteiros')).toBe('prospeccao')
    expect(telaDaRota('PATCH', '/v1/carteira/mensagens/roteiros/:id')).toBe('prospeccao')
    expect(telaDaRota('GET', '/v1/carteira/mensagens/modelos')).toBe('metodo')
    expect(telaDaRota('GET', '/v1/carteira/mensagens/configuracao')).toBe('metodo')
  })
})

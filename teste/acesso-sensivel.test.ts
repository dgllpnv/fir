import 'reflect-metadata'
import { AppModule } from '@fir/api/app.module'
import { DADO_SENSIVEL, type MarcaDeAcesso } from '@fir/api/auditoria/acesso.decorator'
import { registrarCookie } from '@fir/api/main'
import { PATH_METADATA } from '@nestjs/common/constants'
import { MetadataScanner, ModulesContainer, NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * A varredura das rotas marcadas com `@DadoSensivel` — regra 18.
 *
 * O QUE ELA NÃO FAZ, e isto precisa estar escrito: ela **não** sabe dizer que
 * uma rota nova DEVERIA estar marcada. Nenhuma máquina sabe — "esta resposta
 * contém dado de saúde" é julgamento, e a marcação é explícita justamente
 * para que seja. O que ela fecha é a outra classe de defeito, que é
 * verificável: rota marcada de forma incoerente.
 *
 * Duas incoerências, as duas silenciosas até o pior momento:
 *
 *  1. `@DadoSensivel('pacientes', { param: 'pacienteId' })` num caminho que
 *     se chama `:id`. O interceptor falha fechado — mas em tempo de EXECUÇÃO,
 *     na primeira vez que alguém abrir a ficha em produção.
 *  2. Um nome de entidade que não é tabela nenhuma. Não levanta nada: apenas
 *     FRAGMENTA a trilha, e "o que aconteceu com esta pessoa" passa a
 *     esconder as linhas digitadas errado. A união literal do decorador pega
 *     o erro de digitação; o catálogo pega o nome plausível que nunca existiu.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

type RotaMarcada = {
  readonly caminho: string
  readonly controlador: string
  readonly handler: string
  readonly marca: MarcaDeAcesso
}

const juntar = (...partes: (string | undefined)[]): string => {
  const limpo = partes
    .filter((p): p is string => typeof p === 'string')
    .flatMap((p) => p.split('/'))
    .filter((p) => p !== '')
  return `/${limpo.join('/')}`
}

let app: NestFastifyApplication
let migrate: pg.Client
let marcadas: RotaMarcada[]
let tabelas: Set<string>

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[acesso-sensivel] migrate:', e.message))
  await migrate.connect()
  const r = await migrate.query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')`,
  )
  tabelas = new Set(r.rows.map((x) => x.relname))

  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
  })
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  // Mesmo mecanismo de `rotas-protegidas.test.ts`: a fonte da verdade é o
  // módulo de verdade, subido de verdade — não uma lista escrita à mão.
  const scanner = new MetadataScanner()
  marcadas = []
  for (const [, modulo] of app.get(ModulesContainer)) {
    for (const [, wrapper] of modulo.controllers) {
      const classe = wrapper.metatype
      const instancia = wrapper.instance
      if (typeof classe !== 'function' || instancia === null || typeof instancia !== 'object') {
        continue
      }
      const prefixo = Reflect.getMetadata(PATH_METADATA, classe) as string | undefined
      const marcaDaClasse = Reflect.getMetadata(DADO_SENSIVEL, classe) as MarcaDeAcesso | undefined
      const proto = Object.getPrototypeOf(instancia) as Record<string, unknown>

      for (const nome of scanner.getAllMethodNames(proto)) {
        const handler = proto[nome]
        if (typeof handler !== 'function') continue
        const caminho = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined
        if (caminho === undefined) continue
        // `getAllAndOverride` do Reflector, à mão: a marca do handler vence a
        // da classe, como o interceptor faz.
        const marca =
          (Reflect.getMetadata(DADO_SENSIVEL, handler) as MarcaDeAcesso | undefined) ?? marcaDaClasse
        if (marca === undefined) continue
        marcadas.push({ caminho: juntar(prefixo, caminho), controlador: classe.name, handler: nome, marca })
      }
    }
  }
})

afterAll(async () => {
  await migrate.end()
  await app.close()
})

describe('toda rota marcada com @DadoSensivel é marcada de forma coerente', () => {
  it('a varredura encontrou rota marcada — senão ela não verificou nada', () => {
    // O piso. Sem ele, um `ModulesContainer` que mudasse de forma numa
    // atualização do Nest faria os dois `it` abaixo passarem varrendo uma
    // lista vazia — foi assim que três `it` deste pacote executaram zero
    // asserção útil por meses.
    expect(
      marcadas.length,
      'nenhuma rota com @DadoSensivel encontrada — a varredura não verificou nada',
    ).toBeGreaterThan(0)
  })

  it('o parâmetro declarado existe no caminho da rota', () => {
    for (const r of marcadas) {
      if ('lista' in r.marca.de) continue
      expect(
        r.caminho.split('/').includes(`:${r.marca.de.param}`),
        `${r.caminho} (${r.controlador}.${r.handler}) declara @DadoSensivel com o parâmetro ` +
          `"${r.marca.de.param}", que não existe no caminho. O interceptor falharia fechado em ` +
          'produção, na primeira vez que alguém abrisse a ficha.',
      ).toBe(true)
    }
  })

  it('a entidade declarada é uma relação de verdade do banco', () => {
    for (const r of marcadas) {
      expect(
        tabelas.has(r.marca.entidade),
        `${r.caminho} (${r.controlador}.${r.handler}) registra acesso como entidade ` +
          `"${r.marca.entidade}", que não existe em public. A trilha ficaria partida entre esse ` +
          'nome e o que a trigger de escrita grava (TG_TABLE_NAME).',
      ).toBe(true)
    }
  })
})

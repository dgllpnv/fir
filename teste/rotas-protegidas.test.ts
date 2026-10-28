import 'reflect-metadata'
import { AppModule } from '@fir/api/app.module'
import { apagarClinicaDeTeste, declararAtorSistema } from '@fir/api/banco/limpeza-de-teste'
import { hashDeSenha } from '@fir/api/autenticacao/senha'
import { registrarCookie } from '@fir/api/main'
import { RequestMethod } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { MetadataScanner, ModulesContainer, NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ROTAS_COM_DINHEIRO, ROTAS_PUBLICAS } from './registro'

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

describe('ROTAS_COM_DINHEIRO descreve rotas que EXISTEM', () => {
  /**
   * O registro era uma lista de promessas.
   *
   * Durante as Tasks 1–7 do épico 4 ele ganhou **onze rotas que ainda não
   * existiam** — os contratos delas já estavam escritos, e sem o registro a
   * varredura de `redacao-de-valores` acusaria campo monetário descoberto.
   * Foi a escolha certa naquele momento e uma dívida registrada como tal: se
   * aquelas tasks mudassem de caminho, o registro mentiria, e nada acusaria.
   *
   * Esta é a outra metade. A varredura confronta o registro com o catálogo de
   * rotas do Nest — o módulo de verdade, subido de verdade — e reprova tanto a
   * promessa não cumprida quanto o caminho escrito errado. É o mesmo padrão de
   * `ROTAS_PUBLICAS`: duas direções, e a mensagem nomeia a rota.
   */
  it('toda rota registrada existe no AppModule, com o mesmo método e caminho', () => {
    const existentes = new Set(rotas.map(chave))
    expect(existentes.size, 'nenhuma rota encontrada — a varredura não verificou nada').toBeGreaterThan(10)

    const fantasmas = ROTAS_COM_DINHEIRO.map(chave).filter((k) => !existentes.has(k))
    expect(
      fantasmas,
      `ROTAS_COM_DINHEIRO (teste/registro.ts) descreve rota(s) que não existem: ${fantasmas.join(', ')}. ` +
        'Ou a rota mudou de caminho, ou o registro ficou para trás — e um registro que mente é ' +
        'pior que um registro vazio, porque o próximo leitor confia nele.',
    ).toEqual([])
  })
})

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

/**
 * A MESMA varredura, para a senha provisória.
 *
 * Lista escrita à mão falha no endpoint número quarenta; varredura não. O que
 * se protege aqui é a classe inteira: a rota que alguém escrever amanhã nasce
 * recusando uma sessão com senha provisória, e abrir uma exige acrescentar
 * uma linha a `LIBERADAS`, que é visível na revisão.
 *
 * Por que isso importa mais do que parece: a provisória foi gerada pelo
 * servidor, DITADA no balcão e anotada num papel. Ela é uma credencial
 * compartilhada por construção — a recepcionista, quem a ditou e quem
 * estava ao lado a conhecem. A única coisa que ela pode fazer é deixar de ser.
 */
describe('nenhuma rota de negócio atravessa a senha provisória', () => {
  const LIBERADAS = new Set(['GET /v1/eu', 'POST /v1/eu/senha', 'POST /v1/sair'])

  let migrate: pg.Client
  let clinica: string
  let cookie: string[]
  const codigo = `prov-${Date.now()}`
  const PROVISORIA = 'pinheiro-balde-sete-azul'

  beforeAll(async () => {
    migrate = new pg.Client({
      connectionString:
        process.env['DATABASE_URL_MIGRATE'] ??
        'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir',
    })
    await migrate.connect()
    await declararAtorSistema(migrate)

    clinica = (
      await migrate.query<{ id: string }>(
        `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica da Provisória') RETURNING id`,
        [codigo],
      )
    ).rows[0]!.id
    // ADMIN de propósito: `temPerm` libera tudo para quem é admin, então
    // nenhum 403 pode mascarar um 409 que não veio. A varredura mede o guard
    // da provisória, não a matriz de permissões.
    await migrate.query(
      `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin,
                            senha_provisoria, senha_provisoria_expira_em)
       VALUES ($1, 'Ana Nova', 'ana.nova', $2, true, true, now() + interval '72 hours')`,
      [clinica, await hashDeSenha(PROVISORIA)],
    )

    const fastify = app.getHttpAdapter().getInstance()
    const r = await fastify.inject({
      method: 'POST',
      url: '/v1/entrar',
      payload: { clinica: codigo, usuario: 'ana.nova', senha: PROVISORIA },
    })
    expect(r.statusCode, 'a fixture não conseguiu entrar com a provisória').toBe(200)
    const bruto = r.headers['set-cookie']
    cookie = Array.isArray(bruto) ? bruto : [String(bruto)]
  })

  afterAll(async () => {
    await apagarClinicaDeTeste(migrate, clinica)
    await migrate.end()
  })

  it('TODA rota não-pública e não-liberada responde 409 SENHA_PROVISORIA', async () => {
    const fastify = app.getHttpAdapter().getInstance()
    const alvos = rotas.filter((r) => !r.publico && !LIBERADAS.has(chave(r)))
    expect(
      alvos.length,
      'nenhuma rota a verificar — ou tudo virou público, ou a varredura quebrou',
    ).toBeGreaterThan(5)

    for (const rota of alvos) {
      const url = rota.caminho.replace(/:[^/]+/g, '00000000-0000-0000-0000-000000000000')
      const metodo = rota.metodo === 'ALL' ? 'GET' : rota.metodo
      const r = await fastify.inject({
        method: metodo as 'GET',
        url,
        payload: {},
        cookies: Object.fromEntries(
          cookie.map((c) => {
            const [nome, ...resto] = c.split(';')[0]!.split('=')
            return [nome!, resto.join('=')]
          }),
        ),
      })
      expect(
        r.statusCode,
        `${rota.metodo} ${rota.caminho} (${rota.controlador}.${rota.handler}) respondeu ` +
          `${r.statusCode} para uma sessão com SENHA PROVISÓRIA, e não 409.`,
      ).toBe(409)
      expect(r.json()).toMatchObject({ codigo: 'SENHA_PROVISORIA' })
    }
  })

  it('as três rotas LIBERADAS de fato respondem — senão a pessoa fica presa', async () => {
    const fastify = app.getHttpAdapter().getInstance()
    const chavesExistentes = new Set(rotas.map(chave))
    for (const k of LIBERADAS) {
      expect(chavesExistentes.has(k), `${k} está em LIBERADAS mas não existe no AppModule`).toBe(
        true,
      )
    }
    const r = await fastify.inject({
      method: 'GET',
      url: '/v1/eu',
      cookies: Object.fromEntries(
        cookie.map((c) => {
          const [nome, ...resto] = c.split(';')[0]!.split('=')
          return [nome!, resto.join('=')]
        }),
      ),
    })
    expect(r.statusCode).toBe(200)
    expect(r.json().usuario.senhaProvisoria).toBe(true)
  })
})

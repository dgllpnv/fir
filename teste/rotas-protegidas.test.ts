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
  readonly soOperador: boolean
  readonly soCarteira: boolean
  readonly soPortal: boolean
}

/** Mesma chave de `apps/api/src/autorizacao/publico.decorator.ts`. */
const PUBLICO = 'fir:publico'

/** Mesma chave de `apps/api/src/painel/so-operador.decorator.ts`. */
const SO_OPERADOR = 'fir:so-operador'

/** Mesma chave de `apps/api/src/carteira/so-usuario-de-gestao.decorator.ts`. */
const SO_USUARIO_DE_GESTAO = 'fir:so-usuario-de-gestao'

/** Mesma chave de `apps/api/src/carteira/portal/so-usuario-do-portal.decorator.ts`. */
const SO_USUARIO_DO_PORTAL = 'fir:so-usuario-do-portal'

/**
 * O segmento que a allowlist do Traefik casa (`infra/producao`). Toda rota de
 * painel tem de estar debaixo dele, e nenhuma rota de produto pode estar.
 */
const SEGMENTO_DO_PAINEL = 'superadmin'

/**
 * O segmento da carteira comercial (decisão Q5 do grilling). Sem allowlist de
 * IP por trás dela, por decisão do dono (ADR 0012, emenda 2026-11-05) — o
 * segmento ainda importa para a mesma higiene de nomenclatura que o painel já
 * cobra: nenhuma rota de produto nem de painel pode estar sob ele, e vice-versa.
 */
const SEGMENTO_DA_CARTEIRA = 'carteira'

/**
 * As duas rotas de painel que o `PainelGuard` libera, pelas razões escritas
 * lá: `entrar` CRIA a sessão, e `sair` precisa poder limpar um cookie morto.
 */
const LIBERADAS_NO_PAINEL: ReadonlySet<string> = new Set([
  'POST /v1/superadmin/entrar',
  'POST /v1/superadmin/sair',
])

/** A mesma forma, para a carteira. */
const LIBERADAS_NA_CARTEIRA: ReadonlySet<string> = new Set([
  'POST /v1/carteira/entrar',
  'POST /v1/carteira/sair',
])

/** O segmento do Portal do Grupo (G6) — quarto espaço de identidade. */
const SEGMENTO_DO_PORTAL = 'portal'

/** A mesma forma, para o portal. */
const LIBERADAS_NO_PORTAL: ReadonlySet<string> = new Set([
  'POST /v1/portal/entrar',
  'POST /v1/portal/sair',
])

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
      const painelNaClasse = Reflect.getMetadata(SO_OPERADOR, classe) === true
      const carteiraNaClasse = Reflect.getMetadata(SO_USUARIO_DE_GESTAO, classe) === true
      const portalNaClasse = Reflect.getMetadata(SO_USUARIO_DO_PORTAL, classe) === true
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
          soOperador: painelNaClasse || Reflect.getMetadata(SO_OPERADOR, handler) === true,
          soCarteira: carteiraNaClasse || Reflect.getMetadata(SO_USUARIO_DE_GESTAO, handler) === true,
          soPortal: portalNaClasse || Reflect.getMetadata(SO_USUARIO_DO_PORTAL, handler) === true,
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

  /**
   * **NENHUMA ROTA PÚBLICA LISTA CLÍNICAS.** D-12, decisão do dono de
   * 2026-11-02, cobrada aqui porque a tentação volta.
   *
   * O pedido era um menu com as clínicas cadastradas na tela de entrada, no
   * lugar do campo onde se digita o código. Isso exige uma rota que responde
   * **antes de qualquer autenticação**, e ela custa duas coisas: publica a
   * lista de clientes do produto, e tira **um dos dois desconhecidos** da
   * credencial — hoje é clínica + usuário + senha, viraria usuário + senha, e
   * usuário é adivinhável (`recepcao`, `ana`). É a mesma classe do
   * `equipePublica` da v20, que removemos de propósito por listar a equipe
   * antes do login.
   *
   * O que entrou no lugar: `/entrar?clinica=CODIGO` **pré-seleciona** a
   * clínica (é como as quatro clínicas já entram, pelo favorito), e o seletor
   * com a lista mora no painel do superadmin — autenticado, e atrás da
   * allowlist de IP do escritório.
   *
   * O caminho é só uma heurística, e é de propósito: ela não tenta adivinhar
   * o que a rota devolve, ela recusa a PALAVRA no caminho de uma rota pública.
   * Quem precisar de uma rota pública com `clinica` no nome passa por esta
   * mensagem antes, que é exatamente o ponto.
   */
  it('nenhuma rota pública menciona CLÍNICA no caminho — D-12', () => {
    const publicas = rotas.filter((r) => r.publico)
    expect(publicas.length, 'nenhuma rota pública encontrada — a varredura quebrou').toBeGreaterThan(
      0,
    )

    const suspeitas = publicas.filter((r) => /clinica/i.test(r.caminho)).map(chave)
    expect(
      suspeitas,
      `rota(s) pública(s) com "clinica" no caminho: ${suspeitas.join(', ')}. ` +
        'D-12: nenhuma rota pública lista nem descreve clínicas. Uma rota que responde antes do ' +
        'login publica a lista de clientes e tira um dos dois desconhecidos da credencial — é a ' +
        'classe do `equipePublica` da v20. O seletor de clínicas mora no PAINEL do superadmin; a ' +
        'tela de entrada recebe a clínica pelo link (?clinica=CODIGO).',
    ).toEqual([])
  })

  it('TODA rota não-pública e de CLÍNICA responde 401 sem cookie de sessão', async () => {
    const fastify = app.getHttpAdapter().getInstance()
    // Rota de painel e de carteira ficam fora: elas respondem 404 sem o
    // cookie próprio, e os `describe`s delas são quem cobra isso. 401 lá
    // confirmaria que a rota existe.
    const protegidas = rotas.filter((r) => !r.publico && !r.soOperador && !r.soCarteira && !r.soPortal)
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
    // Rota de painel e de carteira ficam fora: nenhuma das duas usa a sessão
    // do produto, e um cookie de clínica com senha provisória não as alcança
    // de jeito nenhum — os guards delas respondem 404 antes.
    const alvos = rotas.filter(
      (r) => !r.publico && !r.soOperador && !r.soCarteira && !r.soPortal && !LIBERADAS.has(chave(r)),
    )
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

/**
 * A MESMA varredura, para o terceiro estado: **só-operador**.
 *
 * Toda rota do Nest é exatamente um de três — pública, de clínica, ou de
 * painel. Os dois erros que isto pega são de copiar-e-colar, e os dois são
 * caros:
 *
 *  - uma rota de painel SEM `@SoOperador()` cairia no `SessaoGuard` do
 *    produto, exigiria cookie de clínica e precisaria de um `req.contexto`
 *    que o painel não tem;
 *  - uma rota de produto COM `@SoOperador()` sairia do controle de permissão
 *    da clínica inteiro — e do guard da senha provisória junto.
 *
 * E a terceira asserção é a que amarra a infraestrutura ao código: a
 * allowlist do Traefik (`infra/producao/docker-compose.yml`) casa **um
 * segmento chamado `superadmin`**. Uma rota de painel fora desse segmento
 * ficaria **na frente da allowlist**, exposta à internet; uma rota de produto
 * dentro dele seria bloqueada para a clínica inteira. As duas reprovam aqui.
 */
describe('toda rota é exatamente um de cinco: pública, de clínica, de painel, de carteira, ou do portal', () => {
  it('nenhuma rota é pública E só-operador ao mesmo tempo', () => {
    const confusas = rotas.filter((r) => r.publico && r.soOperador).map(chave)
    expect(
      confusas,
      `rota(s) marcadas @Publico() E @SoOperador(): ${confusas.join(', ')}. ` +
        'Os dois estados se excluem — @Publico() dispensa sessão, @SoOperador() exige a do painel.',
    ).toEqual([])
  })

  it('nenhuma rota é pública E só-carteira ao mesmo tempo', () => {
    const confusas = rotas.filter((r) => r.publico && r.soCarteira).map(chave)
    expect(
      confusas,
      `rota(s) marcadas @Publico() E @SoUsuarioDeGestao(): ${confusas.join(', ')}. ` +
        'Os dois estados se excluem — @Publico() dispensa sessão, @SoUsuarioDeGestao() exige a da carteira.',
    ).toEqual([])
  })

  it('nenhuma rota é só-operador E só-carteira ao mesmo tempo', () => {
    const confusas = rotas.filter((r) => r.soOperador && r.soCarteira).map(chave)
    expect(
      confusas,
      `rota(s) marcadas @SoOperador() E @SoUsuarioDeGestao(): ${confusas.join(', ')}. ` +
        'Os dois são espaços de identidade disjuntos — Operador e Usuário de Gestão não se cruzam.',
    ).toEqual([])
  })

  it('nenhuma rota é pública E só-portal ao mesmo tempo', () => {
    const confusas = rotas.filter((r) => r.publico && r.soPortal).map(chave)
    expect(
      confusas,
      `rota(s) marcadas @Publico() E @SoUsuarioDoPortal(): ${confusas.join(', ')}. ` +
        'Os dois estados se excluem — @Publico() dispensa sessão, @SoUsuarioDoPortal() exige a do portal.',
    ).toEqual([])
  })

  it('nenhuma rota é só-operador/só-carteira E só-portal ao mesmo tempo — quatro espaços disjuntos', () => {
    const confusas = rotas.filter((r) => (r.soOperador || r.soCarteira) && r.soPortal).map(chave)
    expect(
      confusas,
      `rota(s) marcadas @SoOperador()/@SoUsuarioDeGestao() E @SoUsuarioDoPortal(): ${confusas.join(', ')}. ` +
        'Operador, Usuário de Gestão e Usuário do portal são três espaços de identidade disjuntos.',
    ).toEqual([])
  })

  it('toda rota só-operador está sob o segmento `superadmin`, e só elas', () => {
    const temSegmento = (caminho: string) =>
      caminho.split('/').some((p) => p.toLowerCase() === SEGMENTO_DO_PAINEL)

    const foraDaAllowlist = rotas.filter((r) => r.soOperador && !temSegmento(r.caminho)).map(chave)
    expect(
      foraDaAllowlist,
      `rota(s) de painel FORA do segmento /${SEGMENTO_DO_PAINEL}: ${foraDaAllowlist.join(', ')}. ` +
        'A allowlist de IP do Traefik casa esse segmento; fora dele a rota fica na frente da ' +
        'allowlist, exposta à internet.',
    ).toEqual([])

    const dentroSemMarca = rotas.filter((r) => !r.soOperador && temSegmento(r.caminho)).map(chave)
    expect(
      dentroSemMarca,
      `rota(s) de PRODUTO sob /${SEGMENTO_DO_PAINEL}: ${dentroSemMarca.join(', ')}. ` +
        'A allowlist bloquearia essa rota para a clínica inteira, e o sintoma seria ' +
        '"dá 403 para todo mundo menos para o escritório".',
    ).toEqual([])
  })

  it('toda rota só-carteira está sob o segmento `carteira`, e só elas', () => {
    const temSegmento = (caminho: string) =>
      caminho.split('/').some((p) => p.toLowerCase() === SEGMENTO_DA_CARTEIRA)

    const foraDoSegmento = rotas.filter((r) => r.soCarteira && !temSegmento(r.caminho)).map(chave)
    expect(
      foraDoSegmento,
      `rota(s) de carteira FORA do segmento /${SEGMENTO_DA_CARTEIRA}: ${foraDoSegmento.join(', ')}.`,
    ).toEqual([])

    const dentroSemMarca = rotas.filter((r) => !r.soCarteira && temSegmento(r.caminho)).map(chave)
    expect(
      dentroSemMarca,
      `rota(s) fora da carteira sob /${SEGMENTO_DA_CARTEIRA}: ${dentroSemMarca.join(', ')}.`,
    ).toEqual([])
  })

  it('toda rota só-portal está sob o segmento `portal`, e só elas', () => {
    const temSegmento = (caminho: string) =>
      caminho.split('/').some((p) => p.toLowerCase() === SEGMENTO_DO_PORTAL)

    const foraDoSegmento = rotas.filter((r) => r.soPortal && !temSegmento(r.caminho)).map(chave)
    expect(
      foraDoSegmento,
      `rota(s) do portal FORA do segmento /${SEGMENTO_DO_PORTAL}: ${foraDoSegmento.join(', ')}.`,
    ).toEqual([])

    // As rotas de ADMINISTRAÇÃO de conta do portal (`/v1/carteira/acessos-
    // do-portal`, `/v1/superadmin/acessos-do-portal`) são, de propósito,
    // soCarteira/soOperador — nunca soPortal (nunca autoatendimento, spec
    // §1.3) — e por isso o segmento literal é `acessos-do-portal`, não
    // `portal`: evita que elas caiam nesta checagem por engano.
    const dentroSemMarca = rotas.filter((r) => !r.soPortal && temSegmento(r.caminho)).map(chave)
    expect(
      dentroSemMarca,
      `rota(s) fora do portal sob /${SEGMENTO_DO_PORTAL}: ${dentroSemMarca.join(', ')}.`,
    ).toEqual([])
  })

  it('TODA rota de painel que exige sessão responde 404 sem cookie de painel', async () => {
    const fastify = app.getHttpAdapter().getInstance()
    const alvos = rotas.filter((r) => r.soOperador && !LIBERADAS_NO_PAINEL.has(chave(r)))
    expect(
      alvos.length,
      'nenhuma rota de painel a verificar — ou a marca sumiu, ou a varredura quebrou',
    ).toBeGreaterThan(0)

    for (const rota of alvos) {
      const url = rota.caminho.replace(/:[^/]+/g, '00000000-0000-0000-0000-000000000000')
      const metodo = rota.metodo === 'ALL' ? 'GET' : rota.metodo
      const r = await fastify.inject({ method: metodo as 'GET', url, payload: {} })
      expect(
        r.statusCode,
        `${rota.metodo} ${rota.caminho} (${rota.controlador}.${rota.handler}) respondeu ` +
          `${r.statusCode} sem cookie de painel, e não 404. ` +
          '401 confirmaria que a rota existe; 200 seria o painel aberto.',
      ).toBe(404)
    }
  })

  describe('e o cookie de CLÍNICA não abre nenhuma delas', () => {
    let migrate: pg.Client
    let clinica: string
    let cookieDeClinica: Record<string, string>
    const codigo = `naopainel-${Date.now()}`
    const SENHA = 'quatro-pedras-no-caminho'

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
          `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica sem painel') RETURNING id`,
          [codigo],
        )
      ).rows[0]!.id
      // ADMIN de propósito: `temPerm` libera tudo para quem é admin, então
      // nenhum 403 pode mascarar um 404 que não veio.
      await migrate.query(
        `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin)
         VALUES ($1, 'Admin da clínica', 'admin.clinica', $2, true)`,
        [clinica, await hashDeSenha(SENHA)],
      )

      const fastify = app.getHttpAdapter().getInstance()
      const entrada = await fastify.inject({
        method: 'POST',
        url: '/v1/entrar',
        payload: { clinica: codigo, usuario: 'admin.clinica', senha: SENHA },
      })
      expect(entrada.statusCode, 'a fixture de clínica não conseguiu entrar').toBe(200)
      const bruto = entrada.headers['set-cookie']
      cookieDeClinica = Object.fromEntries(
        (Array.isArray(bruto) ? bruto : [String(bruto)]).map((c) => {
          const [nome, ...resto] = c.split(';')[0]!.split('=')
          return [nome!, resto.join('=')]
        }),
      )
    })

    afterAll(async () => {
      await apagarClinicaDeTeste(migrate, clinica)
      await migrate.end()
    })

    it('TODA rota de painel responde 404 para uma sessão de clínica', async () => {
      const fastify = app.getHttpAdapter().getInstance()
      const alvos = rotas.filter((r) => r.soOperador && !LIBERADAS_NO_PAINEL.has(chave(r)))
      for (const rota of alvos) {
        const url = rota.caminho.replace(/:[^/]+/g, '00000000-0000-0000-0000-000000000000')
        const metodo = rota.metodo === 'ALL' ? 'GET' : rota.metodo
        const r = await fastify.inject({
          method: metodo as 'GET',
          url,
          payload: {},
          cookies: cookieDeClinica,
        })
        expect(
          r.statusCode,
          `${rota.metodo} ${rota.caminho} respondeu ${r.statusCode} para uma sessão de CLÍNICA. ` +
            'O cookie do produto não pode abrir o painel: se abrir, qualquer admin de qualquer ' +
            'clínica alcança todas as outras.',
        ).toBe(404)
      }
    })
  })

  it('TODA rota de carteira que exige sessão responde 404 sem cookie de carteira', async () => {
    const fastify = app.getHttpAdapter().getInstance()
    const alvos = rotas.filter((r) => r.soCarteira && !LIBERADAS_NA_CARTEIRA.has(chave(r)))
    expect(
      alvos.length,
      'nenhuma rota de carteira a verificar — ou a marca sumiu, ou a varredura quebrou',
    ).toBeGreaterThan(0)

    for (const rota of alvos) {
      const url = rota.caminho.replace(/:[^/]+/g, '00000000-0000-0000-0000-000000000000')
      const metodo = rota.metodo === 'ALL' ? 'GET' : rota.metodo
      const r = await fastify.inject({ method: metodo as 'GET', url, payload: {} })
      expect(
        r.statusCode,
        `${rota.metodo} ${rota.caminho} (${rota.controlador}.${rota.handler}) respondeu ` +
          `${r.statusCode} sem cookie de carteira, e não 404.`,
      ).toBe(404)
    }
  })

  describe('e o cookie de CLÍNICA não abre nenhuma rota de carteira', () => {
    let migrate: pg.Client
    let clinica: string
    let cookieDeClinica: Record<string, string>
    const codigo = `naocarteira-${Date.now()}`
    const SENHA = 'quatro-pedras-no-caminho'

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
          `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica sem carteira') RETURNING id`,
          [codigo],
        )
      ).rows[0]!.id
      await migrate.query(
        `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin)
         VALUES ($1, 'Admin da clínica', 'admin.clinica2', $2, true)`,
        [clinica, await hashDeSenha(SENHA)],
      )

      const fastify = app.getHttpAdapter().getInstance()
      const entrada = await fastify.inject({
        method: 'POST',
        url: '/v1/entrar',
        payload: { clinica: codigo, usuario: 'admin.clinica2', senha: SENHA },
      })
      expect(entrada.statusCode, 'a fixture de clínica não conseguiu entrar').toBe(200)
      const bruto = entrada.headers['set-cookie']
      cookieDeClinica = Object.fromEntries(
        (Array.isArray(bruto) ? bruto : [String(bruto)]).map((c) => {
          const [nome, ...resto] = c.split(';')[0]!.split('=')
          return [nome!, resto.join('=')]
        }),
      )
    })

    afterAll(async () => {
      await apagarClinicaDeTeste(migrate, clinica)
      await migrate.end()
    })

    it('TODA rota de carteira responde 404 para uma sessão de clínica', async () => {
      const fastify = app.getHttpAdapter().getInstance()
      const alvos = rotas.filter((r) => r.soCarteira && !LIBERADAS_NA_CARTEIRA.has(chave(r)))
      for (const rota of alvos) {
        const url = rota.caminho.replace(/:[^/]+/g, '00000000-0000-0000-0000-000000000000')
        const metodo = rota.metodo === 'ALL' ? 'GET' : rota.metodo
        const r = await fastify.inject({
          method: metodo as 'GET',
          url,
          payload: {},
          cookies: cookieDeClinica,
        })
        expect(
          r.statusCode,
          `${rota.metodo} ${rota.caminho} respondeu ${r.statusCode} para uma sessão de CLÍNICA. ` +
            'O cookie do produto não pode abrir a carteira.',
        ).toBe(404)
      }
    })
  })

  it('TODA rota do portal que exige sessão responde 404 sem cookie de portal', async () => {
    const fastify = app.getHttpAdapter().getInstance()
    const alvos = rotas.filter((r) => r.soPortal && !LIBERADAS_NO_PORTAL.has(chave(r)))
    expect(
      alvos.length,
      'nenhuma rota do portal a verificar — ou a marca sumiu, ou a varredura quebrou',
    ).toBeGreaterThan(0)

    for (const rota of alvos) {
      const url = rota.caminho.replace(/:[^/]+/g, '00000000-0000-0000-0000-000000000000')
      const metodo = rota.metodo === 'ALL' ? 'GET' : rota.metodo
      const r = await fastify.inject({ method: metodo as 'GET', url, payload: {} })
      expect(
        r.statusCode,
        `${rota.metodo} ${rota.caminho} (${rota.controlador}.${rota.handler}) respondeu ` +
          `${r.statusCode} sem cookie de portal, e não 404.`,
      ).toBe(404)
    }
  })

  describe('e o cookie de CLÍNICA não abre nenhuma rota do portal', () => {
    let migrate: pg.Client
    let clinica: string
    let cookieDeClinica: Record<string, string>
    const codigo = `naoportal-${Date.now()}`
    const SENHA = 'quatro-pedras-no-caminho'

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
          `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica sem portal') RETURNING id`,
          [codigo],
        )
      ).rows[0]!.id
      await migrate.query(
        `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin)
         VALUES ($1, 'Admin da clínica', 'admin.clinica3', $2, true)`,
        [clinica, await hashDeSenha(SENHA)],
      )

      const fastify = app.getHttpAdapter().getInstance()
      const entrada = await fastify.inject({
        method: 'POST',
        url: '/v1/entrar',
        payload: { clinica: codigo, usuario: 'admin.clinica3', senha: SENHA },
      })
      expect(entrada.statusCode, 'a fixture de clínica não conseguiu entrar').toBe(200)
      const bruto = entrada.headers['set-cookie']
      cookieDeClinica = Object.fromEntries(
        (Array.isArray(bruto) ? bruto : [String(bruto)]).map((c) => {
          const [nome, ...resto] = c.split(';')[0]!.split('=')
          return [nome!, resto.join('=')]
        }),
      )
    })

    afterAll(async () => {
      await apagarClinicaDeTeste(migrate, clinica)
      await migrate.end()
    })

    it('TODA rota do portal responde 404 para uma sessão de clínica', async () => {
      const fastify = app.getHttpAdapter().getInstance()
      const alvos = rotas.filter((r) => r.soPortal && !LIBERADAS_NO_PORTAL.has(chave(r)))
      for (const rota of alvos) {
        const url = rota.caminho.replace(/:[^/]+/g, '00000000-0000-0000-0000-000000000000')
        const metodo = rota.metodo === 'ALL' ? 'GET' : rota.metodo
        const r = await fastify.inject({
          method: metodo as 'GET',
          url,
          payload: {},
          cookies: cookieDeClinica,
        })
        expect(
          r.statusCode,
          `${rota.metodo} ${rota.caminho} respondeu ${r.statusCode} para uma sessão de CLÍNICA. ` +
            'O cookie do produto não pode abrir o portal.',
        ).toBe(404)
      }
    })
  })
})

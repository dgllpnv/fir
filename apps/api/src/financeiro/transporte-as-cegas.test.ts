import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  limparTarefas,
  montarCenario,
  pegar,
  postar,
} from '../tarefas/__tests__/cenario'
import { RequestMethod } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { MetadataScanner, ModulesContainer } from '@nestjs/core'
import { ROTAS_DE_CONFERENCIA, ROTAS_FORA_DA_CONFERENCIA } from './rotas-de-conferencia'

/**
 * **A REGRA 6, NO TRANSPORTE.**
 *
 * A conferência às cegas protege contra uma coisa: a pessoa que conta a gaveta
 * olhar o número antes de contar. Isso é invariante de **transporte**, não de
 * tela — quem confere com o esperado à vista confirma o esperado, e a
 * conferência deixa de medir qualquer coisa.
 *
 * Por isso o teste olha o **corpo HTTP cru**, e com o principal mais forte que
 * existe. **Redação não é defesa aqui**: quem fecha o caixa COM `valores`
 * continua precisando conferir às cegas, e um teste feito com usuário fraco
 * provaria a regra 17, não a regra 6.
 *
 * `beatriz` tem `valores`, e é o principal mais forte que importa: a redação
 * decide por `pode('valores')`, e `admin: true` faz `pode` devolver verdadeiro
 * para tudo — ou seja, um admin recebe destas rotas **exatamente o mesmo
 * corpo** que ela. Não há principal que veja mais.
 *
 * **A varredura é DERIVADA do catálogo de rotas**, desde a Task 9: toda rota
 * `GET` registrada no `AppModule` precisa estar em `ROTAS_DE_CONFERENCIA` ou
 * em `ROTAS_FORA_DA_CONFERENCIA`, com razão escrita. Antes disso a lista era
 * mantida à mão e esquecer de acrescentar uma rota nova não acusava nada — que
 * é a fraqueza anotada no relatório das Tasks 1–7, e a mesma que o `curinga`
 * do épico 2 expôs.
 */
let c: Cenario

/** Todas as chaves do corpo, em qualquer profundidade. */
function chavesProfundas(x: unknown, saida: Set<string> = new Set()): Set<string> {
  if (x === null || typeof x !== 'object') return saida
  if (Array.isArray(x)) {
    for (const i of x) chavesProfundas(i, saida)
    return saida
  }
  for (const [k, v] of Object.entries(x)) {
    saida.add(k)
    chavesProfundas(v, saida)
  }
  return saida
}

const registrar = (valor: string, forma: string) =>
  postar(
    c,
    '/v1/recebimentos',
    {
      requisicaoId: randomUUID(),
      pacienteId: c.pacientes['ana'],
      valor,
      forma,
      em: HOJE,
      ref: 'consulta',
    },
    'beatriz',
  )

/**
 * O dia sob teste, e os números que o teste persegue.
 *
 * **DUAS parcelas na MESMA forma**, e isso é o ponto — não um detalhe de
 * fixture. Com uma parcela por forma, o agregado POR FORMA é igual à parcela
 * individual, e um campo "por forma" renomeado atravessaria sem produzir
 * número novo: medido, a mutação `esperado` → `previsto` passou verde com o
 * cenário antigo (45.000 em Pix, 12.000 em dinheiro). Com 45.000 **e** 12.000
 * os dois em Pix, o agregado da forma é 57.000 — um número que NÃO existe na
 * lista individual, e que por isso só pode aparecer se o servidor tiver
 * somado por alguém.
 *
 * `87000` é o total do dia, e pega o agregado geral com qualquer etiqueta.
 */
const PARCELAS = ['45000', '12000', '30000']
const A_SOMA = [
  // por forma (Pix): 45.000 + 12.000
  '57000',
  '570,00',
  '570.00',
  'R$ 570',
  // do dia inteiro: + 30.000 em dinheiro
  '87000',
  '870,00',
  '870.00',
  'R$ 870',
]

beforeAll(async () => {
  c = await montarCenario('cegas')
}, 60_000)

afterAll(async () => {
  await desmontarCenario(c)
})

beforeEach(async () => {
  await limparTarefas(c)
  await registrar('45000', 'Pix')
  await registrar('12000', 'Pix')
  await registrar('30000', 'Dinheiro')
})

describe('o esperado não atravessa antes do fechamento', () => {
  it('O AGREGADO POR FORMA NÃO EXISTE EM ROTA NENHUMA — nem para quem pode tudo', async () => {
    for (const rota of ROTAS_DE_CONFERENCIA) {
      const caminho = rota.caminho.replace(':dia', HOJE)
      const [base, consulta] = caminho.split('?')
      const parametros = Object.fromEntries(new URLSearchParams(consulta ?? '').entries())
      const r = await pegar(c, base!, parametros, 'beatriz')
      expect(r.statusCode, caminho).toBe(200)

      // 1. A CHAVE não existe. `null` não serviria: um campo redigido conta
      //    ao cliente que existe um número ali, e o próximo refactor o
      //    "conserta".
      const chaves = chavesProfundas(r.body)
      for (const proibida of ['esperado', 'porForma', 'diferenca', 'conferido', 'contado']) {
        expect([...chaves], `${caminho} devolve a chave \`${proibida}\``).not.toContain(proibida)
      }

      // 2. E o NÚMERO não aparece no corpo, sob nome nenhum. É ESTA asserção
      //    que pega o campo renomeado — `total`, `resumo`, `previsto`,
      //    `_debug`, ou um agregado "por forma" com outra etiqueta.
      for (const n of A_SOMA) {
        expect(r.text, `${caminho} contém a soma do dia (${n})`).not.toContain(n)
      }
    }
  })

  it('A VARREDURA TEM DENTES: a lista individual ESTÁ lá, e é por isso que a soma some', async () => {
    // Sem esta asserção, uma rota que devolvesse `{}` — ou um 500 — passaria
    // no teste acima e a regra 6 estaria "provada" por ausência de resposta.
    // A lista individual é o instrumento de trabalho da recepção e fica; o
    // que o servidor nunca faz é a SOMA por ela.
    const r = await pegar(c, '/v1/recebimentos', { dia: HOJE }, 'beatriz')
    expect(r.body.itens).toHaveLength(3)
    for (const parcela of PARCELAS) {
      expect(r.text, `a parcela ${parcela} deveria estar na lista`).toContain(parcela)
    }
  })

  it('toda rota de conferência tem razão escrita — a lista não cresce por reflexo', () => {
    expect(ROTAS_DE_CONFERENCIA.length).toBeGreaterThan(0)
    for (const rota of ROTAS_DE_CONFERENCIA) {
      expect(rota.razao.length, rota.caminho).toBeGreaterThan(40)
    }
    for (const rota of ROTAS_FORA_DA_CONFERENCIA) {
      expect(rota.razao.length, rota.caminho).toBeGreaterThan(20)
    }
  })

  it('A LISTA É DERIVADA DO CATÁLOGO: toda rota GET está classificada', () => {
    // Era a fraqueza escrita no relatório anterior: `ROTAS_DE_CONFERENCIA`
    // era mantida à mão, e quem acrescentasse uma rota nova sem lembrar dela
    // não era acusado por nada. A fonte da verdade passa a ser o
    // `ModulesContainer` — o módulo de verdade, subido de verdade —, e a
    // lista só diz o que fazer com cada rota.
    //
    // Só `GET`: a regra 6 é sobre o que ATRAVESSA. `POST /v1/caixa` devolve o
    // caixa já fechado, que é o momento em que o esperado passa a ser
    // legítimo; uma escrita não entrega agregado de dia aberto.
    const classificadas = new Set(
      [...ROTAS_DE_CONFERENCIA, ...ROTAS_FORA_DA_CONFERENCIA].map(
        (r) => r.caminho.split('?')[0] as string,
      ),
    )

    const gets = rotasGet()
    expect(gets.length, 'nenhuma rota GET encontrada — a varredura não verificou nada').toBeGreaterThan(10)

    const soltas = gets.filter((r) => !classificadas.has(r))
    expect(
      soltas,
      `rota(s) GET sem classificação em apps/api/src/financeiro/rotas-de-conferencia.ts: ${soltas.join(', ')}. ` +
        'Pergunte se ela devolve agregado de um dia cujo caixa pode estar aberto e ponha em ' +
        'ROTAS_DE_CONFERENCIA ou em ROTAS_FORA_DA_CONFERENCIA, com a razão escrita.',
    ).toEqual([])

    const fantasmas = [...classificadas].filter((r) => !gets.includes(r))
    expect(
      fantasmas,
      `rota(s) classificada(s) que não existem mais: ${fantasmas.join(', ')}. ` +
        'Registro que descreve rota morta é registro em que o próximo leitor confia.',
    ).toEqual([])
  })
})

/**
 * As rotas `GET` do `AppModule`, lidas do container do Nest.
 *
 * Mesmo mecanismo de `teste/rotas-protegidas.test.ts`: `ModulesContainer` dá
 * os controladores, `MetadataScanner` dá os handlers, `PATH_METADATA` e
 * `METHOD_METADATA` dão caminho e verbo. O `printRoutes` do Fastify também
 * lista, mas devolve texto — e texto não volta ao handler.
 */
function rotasGet(): string[] {
  const scanner = new MetadataScanner()
  const achadas: string[] = []
  for (const [, modulo] of c.app.get(ModulesContainer)) {
    for (const [, wrapper] of modulo.controllers) {
      const classe = wrapper.metatype
      const instancia = wrapper.instance
      if (typeof classe !== 'function' || instancia === null || typeof instancia !== 'object') {
        continue
      }
      const prefixo = Reflect.getMetadata(PATH_METADATA, classe) as string | undefined
      const proto = Object.getPrototypeOf(instancia) as Record<string, unknown>
      for (const nome of scanner.getAllMethodNames(proto)) {
        const handler = proto[nome]
        if (typeof handler !== 'function') continue
        const verbo = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined
        const caminho = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined
        if (verbo === undefined || caminho === undefined) continue
        if (RequestMethod[verbo] !== 'GET') continue
        achadas.push(juntar(prefixo, caminho))
      }
    }
  }
  return achadas
}

const juntar = (...partes: (string | undefined)[]): string =>
  `/${partes
    .filter((p): p is string => typeof p === 'string')
    .flatMap((p) => p.split('/'))
    .filter((p) => p !== '')
    .join('/')}`

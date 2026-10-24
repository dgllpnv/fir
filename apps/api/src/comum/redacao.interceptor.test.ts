import type { CallHandler, ExecutionContext } from '@nestjs/common'
import { of } from 'rxjs'
import { describe, expect, it } from 'vitest'
import { redigir, RedacaoInterceptor } from './redacao.interceptor'

const semValores = (c: string) => c !== 'valores' && c !== 'pessoas.gerir'
const comTudo = () => true

describe('redacao', () => {
  it('apaga campo monetário de quem não tem valores', () => {
    const r = redigir({ id: 't1', descricao: 'Consulta', valor: '15000' }, semValores) as Record<string, unknown>
    expect(r['valor']).toBe(null)
    expect(r['descricao']).toBe('Consulta')
  })

  it('não apaga nada de quem tem valores', () => {
    const r = redigir({ valor: '15000' }, comTudo) as Record<string, unknown>
    expect(r['valor']).toBe('15000')
  })

  it('desce em arrays e objetos aninhados — onde o vazamento mora', () => {
    const entrada = {
      tarefas: [{ valor: '100', paciente: { nome: 'Ana', ltv: '9900' } }],
      resumo: { recebido: '500' },
    }
    const r = redigir(entrada, semValores) as any
    expect(r.tarefas[0].valor).toBe(null)
    expect(r.tarefas[0].paciente.nome).toBe('Ana')
    expect(r.tarefas[0].paciente.ltv).toBe(null)
    expect(r.resumo.recebido).toBe(null)
  })

  it('salario depende de pessoas.gerir, não de valores', () => {
    const soValores = (c: string) => c === 'valores'
    const r = redigir({ salario: '500000', valor: '100' }, soValores) as Record<string, unknown>
    expect(r['salario']).toBe(null)
    expect(r['valor']).toBe('100')
  })

  it('não quebra em null, data e tipos primitivos', () => {
    expect(redigir(null, semValores)).toBe(null)
    expect(redigir('texto', semValores)).toBe('texto')
    expect(redigir(42, semValores)).toBe(42)
    const d = new Date('2026-10-23T00:00:00Z')
    expect(redigir(d, semValores)).toBe(d)
  })

  it('preserva a forma: campo apagado vira null, não some', () => {
    // Se o campo sumisse, o cliente não distinguiria "sem permissão" de
    // "valor ausente", e cada tela precisaria de um `if` a mais.
    const r = redigir({ valor: '1' }, semValores) as Record<string, unknown>
    expect('valor' in r).toBe(true)
  })

  it('não quebra em bigint — o domínio usa bigint em toda parte', () => {
    // typeof bigint é 'bigint', não 'object': passa direto pelo primeiro
    // `if`, antes de qualquer checagem de `instanceof` ou `Array.isArray`.
    const b = 15000n
    expect(redigir(b, semValores)).toBe(b)
  })

  it('não quebra em undefined, e um campo monetário undefined some do map', () => {
    expect(redigir(undefined, semValores)).toBe(undefined)
    const r = redigir({ valor: undefined, descricao: 'x' }, semValores) as Record<string, unknown>
    // Sem permissão, o campo monetário é redigido para null mesmo que o
    // valor de entrada já fosse undefined — a forma da resposta não deve
    // depender do valor que havia antes.
    expect(r['valor']).toBe(null)
    expect(r['descricao']).toBe('x')
  })

  it('não desce em Map, Set ou Buffer — só em objeto simples', () => {
    // Object.entries de um Map ou Set devolve [], então uma recursão ingênua
    // devolveria `{}` e o dado sumiria em silêncio; um Buffer tem índices
    // numéricos próprios e viraria um objeto gigante `{"0":..., "1":...}`.
    // Identidade de referência (toBe), não só forma: nada foi reconstruído.
    const mapa = new Map([['a', '1']])
    const conjunto = new Set(['x', 'y'])
    const bytes = Buffer.from([111, 105])
    expect(redigir(mapa, semValores)).toBe(mapa)
    expect(redigir(conjunto, semValores)).toBe(conjunto)
    expect(redigir(bytes, semValores)).toBe(bytes)
  })

  it('sem contexto na requisição, o interceptor redige tudo — falha fechada', () => {
    const handler: CallHandler = { handle: () => of({ valor: '15000', descricao: 'Consulta' }) }
    const semContexto = { switchToHttp: () => ({ getRequest: () => ({}) }) } as unknown as ExecutionContext
    const interceptor = new RedacaoInterceptor()

    return new Promise<void>((resolve) => {
      interceptor.intercept(semContexto, handler).subscribe((dado) => {
        const r = dado as Record<string, unknown>
        expect(r['valor']).toBe(null)
        expect(r['descricao']).toBe('Consulta')
        resolve()
      })
    })
  })
})

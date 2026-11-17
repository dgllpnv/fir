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

  it('campo em snake_case também é redigido — é a forma que a trilha entrega', () => {
    // `GET /v1/auditoria` devolve `de`/`para` com NOME DE COLUNA do Postgres.
    // Sem normalizar, `valor_aberto` atravessaria inteiro na única rota que
    // entrega o diff de toda escrita da clínica.
    const r = redigir(
      { valor_aberto: '900', valor_orcamento: '1200', nome: 'Ana' },
      semValores,
    ) as Record<string, unknown>
    expect(r['valor_aberto']).toBe(null)
    expect(r['valor_orcamento']).toBe(null)
    // A CHAVE fica como veio: a tela da trilha mostra o nome da coluna que
    // mudou, e reescrevê-lo faria a trilha falar de uma coluna que não existe.
    expect(Object.keys(r)).toEqual(['valor_aberto', 'valor_orcamento', 'nome'])
    expect(r['nome']).toBe('Ana')
  })

  it('toda coluna `*_centavos` é dinheiro, sem precisar estar na lista (appsec T3/T4 B1)', () => {
    // A trilha do lançamento de KPI e da meta de KR: as colunas não estavam em
    // CAMPOS_MONETARIOS e saíam inteiras para quem tem `config` sem `valores`.
    const r = redigir(
      {
        lancamento: { valor_centavos: '150043', valor_numero: null, referencia: '2026-11' },
        metaDoKr: { alvo_centavos: '990077', partida_centavos: '0', tipo: 'ate_data' },
        valorCentavos: '1',
      },
      semValores,
    ) as any
    expect(r.lancamento.valor_centavos).toBe(null)
    expect(r.lancamento.referencia).toBe('2026-11')
    expect(r.metaDoKr.alvo_centavos).toBe(null)
    expect(r.metaDoKr.partida_centavos).toBe(null)
    expect(r.metaDoKr.tipo).toBe('ate_data')
    expect(r.valorCentavos).toBe(null)
    const comValores = redigir({ alvo_centavos: '990077' }, comTudo) as Record<string, unknown>
    expect(comValores['alvo_centavos']).toBe('990077')
  })

  it('o faturamento lido do MedX na trilha: total, exato e contagem de pagamentos somem; a quantidade de estoque, não', () => {
    // A linha de `leituras_de_faturamento_externo` e a do histórico, como a trilha as entrega (spec C.11).
    const r = redigir(
      {
        leitura: { dia: '2026-10-20', faturamento_lido: '10000', faturamento_exato: '1000000', quantidade_de_pagamentos: 1 },
        historico: { faturamento_anterior: '10000', quantidade_de_pagamentos_anterior: 1 },
        estoque: { quantidade: 5 },
      },
      semValores,
    ) as Record<string, Record<string, unknown>>
    expect(r['leitura']).toEqual({
      dia: '2026-10-20',
      faturamento_lido: null,
      faturamento_exato: null,
      quantidade_de_pagamentos: null,
    })
    expect(r['historico']).toEqual({ faturamento_anterior: null, quantidade_de_pagamentos_anterior: null })
    expect(r['estoque']).toEqual({ quantidade: 5 })
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

describe('G8 0.5 — o espaço da rota decide, não a propriedade presente (appsec A-2, F-2)', () => {
  const perfil = (valores: boolean) => ({
    id: 'u1',
    usuario: 'u',
    nome: 'U',
    escopo: 'geral' as const,
    grupoId: null,
    senhaProvisoria: false,
    valores,
    carteira: 'todos' as const,
    modulos: [],
    administrar: false,
    setor: null,
    funcao: null,
    telefone: null,
  })

  class RotaDeCarteira {
    handler() {}
  }
  Reflect.defineMetadata('fir:so-usuario-de-gestao', true, RotaDeCarteira)
  class RotaDoPortal {
    handler() {}
  }
  Reflect.defineMetadata('fir:so-usuario-do-portal', true, RotaDoPortal)
  class RotaDoOperador {
    handler() {}
  }
  Reflect.defineMetadata('fir:so-operador', true, RotaDoOperador)
  class RotaDeClinica {
    handler() {}
  }

  const rodar = (classe: new () => { handler: () => void }, req: object): Promise<Record<string, unknown>> => {
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => classe.prototype.handler,
      getClass: () => classe,
    } as unknown as ExecutionContext
    const handler: CallHandler = { handle: () => of({ mensalidade: '250000', salario: '500000', nome: 'X' }) }
    return new Promise((resolve) => {
      new RedacaoInterceptor().intercept(ctx, handler).subscribe((d) => resolve(d as Record<string, unknown>))
    })
  }

  it('rota de carteira com `valores`: o dinheiro atravessa (o salário, que é de RH, nunca)', async () => {
    const r = await rodar(RotaDeCarteira, { carteira: { usuarioDeGestao: perfil(true) } })
    expect(r['mensalidade']).toBe('250000')
    expect(r['salario']).toBeNull()
  })

  it('rota de carteira sem `valores`: null', async () => {
    const r = await rodar(RotaDeCarteira, { carteira: { usuarioDeGestao: perfil(false) } })
    expect(r['mensalidade']).toBeNull()
  })

  it('rota de carteira sem `req.carteira`: falha fechada, mesmo com `req.portal` presente', async () => {
    const r = await rodar(RotaDeCarteira, { portal: { usuarioDoPortal: { veValores: true } } })
    expect(r['mensalidade']).toBeNull()
  })

  it('cookie de clínica com `valores` numa rota de carteira sem `valores` não libera (caso de abuso 3)', async () => {
    const r = await rodar(RotaDeCarteira, { contexto: { pode: () => true }, carteira: { usuarioDeGestao: perfil(false) } })
    expect(r['mensalidade']).toBeNull()
  })

  it('rota do portal: o titular (`veValores`, LGPD A52) vê o próprio dinheiro; sem sessão do portal, não', async () => {
    expect((await rodar(RotaDoPortal, { portal: { usuarioDoPortal: { veValores: true } } }))['mensalidade']).toBe('250000')
    expect((await rodar(RotaDoPortal, { portal: { usuarioDoPortal: { veValores: false } } }))['mensalidade']).toBeNull()
    expect((await rodar(RotaDoPortal, {}))['mensalidade']).toBeNull()
  })

  it('rota do Operador nunca recebe dinheiro', async () => {
    expect((await rodar(RotaDoOperador, { contexto: { pode: () => true } }))['mensalidade']).toBeNull()
  })

  it('rota de clínica usa a permissão da Pessoa', async () => {
    expect((await rodar(RotaDeClinica, { contexto: { pode: () => true } }))['mensalidade']).toBe('250000')
    expect((await rodar(RotaDeClinica, { carteira: { usuarioDeGestao: perfil(true) } }))['mensalidade']).toBeNull()
  })
})

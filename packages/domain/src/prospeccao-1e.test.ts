import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Dinheiro } from './dinheiro'
import { ehErro, ehOk } from './resultado'
import {
  type EtapaDoLead,
  type LeadParaRanking,
  type LeadParaSinal,
  ETAPAS_DO_LEAD,
  conversaoDasEncerradas,
  decidirPerda,
  etapaSugeridaDepoisDoContato,
  indicacoesQueViraramCliente,
  linkDoWhatsApp,
  normalizarTelefoneDoLead,
  percentualDeContagem,
  proximoContatoSugerido,
  quemIndicou,
  rankingDeQuemIndica,
  resumoDasOportunidades,
  sinalDoLead,
  situacaoDoBeneficio,
  validarRegistroDeContato,
} from './prospeccao'

/*
 * G8 1E — prospecção completa. Cada expectativa cita a linha do protótipo
 * (`versoes/firmare-gestao-prototipo/index.html`) que ela reproduz.
 */

const HOJE = '2026-11-08'
const dia = (n: number): string => new Date(Date.UTC(2026, 10, 8 + n)).toISOString().slice(0, 10)

const base: LeadParaSinal = {
  etapa: 'contato',
  temperatura: 'morno',
  recebidaEm: dia(-30),
  proximoContato: null,
  ultimoContato: dia(-1),
  indicadoPorCliente: false,
  naoContatar: false,
}

describe('percentualDeContagem — (200·a + b) div (2·b), gate de números §3.3', () => {
  it('b = 0 devolve null ("—"), nunca 0% nem NaN', () => {
    expect(percentualDeContagem(0, 0)).toBeNull()
  })

  it('arredonda meio para cima, como Math.round do protótipo para a ≥ 0', () => {
    expect(percentualDeContagem(1, 2)).toBe(50)
    expect(percentualDeContagem(1, 3)).toBe(33)
    expect(percentualDeContagem(2, 3)).toBe(67)
    expect(percentualDeContagem(1, 8)).toBe(13) // 12,5 → 13
    expect(percentualDeContagem(1, 200)).toBe(1) // 0,5 → 1
  })

  it('propriedade: igual a Math.round(a/b·100) e dentro de [0, 100] quando a ≤ b', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), fc.integer({ min: 0, max: 100_000 }), (b, x) => {
        const a = x % (b + 1)
        const p = percentualDeContagem(a, b)!
        expect(p).toBe(Math.round((a * 100) / b))
        expect(p).toBeGreaterThanOrEqual(0)
        expect(p).toBeLessThanOrEqual(100)
        expect(Number.isInteger(p)).toBe(true)
      }),
    )
  })

  it('recusa contagem negativa ou fracionária — é contagem, não medida', () => {
    expect(() => percentualDeContagem(-1, 2)).toThrow()
    expect(() => percentualDeContagem(1.5, 2)).toThrow()
  })
})

describe('as DUAS conversões têm definições diferentes (gate de números, ajuste 15)', () => {
  it('conversão das encerradas = ganhos / (ganhos + perdidos) — L2478/L2481', () => {
    expect(conversaoDasEncerradas(1, 3)).toBe(25)
    expect(conversaoDasEncerradas(0, 0)).toBeNull()
  })

  it('indicações que viraram cliente = ganhos / total, com as em andamento no denominador — L2541', () => {
    expect(indicacoesQueViraramCliente(1, 4)).toBe(25)
    expect(indicacoesQueViraramCliente(0, 0)).toBeNull()
  })

  it('o mesmo funil dá números diferentes nas duas — por isso os nomes não se trocam', () => {
    // 1 ganho, 1 perdido, 2 em andamento.
    expect(conversaoDasEncerradas(1, 1)).toBe(50)
    expect(indicacoesQueViraramCliente(1, 4)).toBe(25)
  })

  it('propriedade: com leads em andamento, a das indicações nunca passa a das encerradas', () => {
    fc.assert(
      fc.property(fc.nat(50), fc.nat(50), fc.nat(50), (ganhos, perdidos, andamento) => {
        fc.pre(ganhos + perdidos > 0)
        const encerradas = conversaoDasEncerradas(ganhos, perdidos)!
        const indicacoes = indicacoesQueViraramCliente(ganhos, ganhos + perdidos + andamento)!
        expect(indicacoes).toBeLessThanOrEqual(encerradas)
        if (andamento === 0) expect(indicacoes).toBe(encerradas)
      }),
    )
  })
})

describe('resumoDasOportunidades — L2474-2481', () => {
  const lead = (etapa: EtapaDoLead, centavos: bigint | null, arquivado = false) => ({
    etapa,
    arquivado,
    valorEstimado: centavos === null ? null : Dinheiro.deCentavos(centavos),
  })

  it('caso do protótipo (leadsExemplo, L523): potencial sem espera nem ganho, 1 de 1 encerrada', () => {
    // l1 contato 2800 · l2 novo 2800 · l3 proposta 3500 · l4 novo 2800 · l5 reuniao 9000
    // l6 espera 2200 · l8 ganho 2800 · l7 contato 2800 — valores em reais × 100.
    const r = resumoDasOportunidades([
      lead('contato', 280000n),
      lead('novo', 280000n),
      lead('proposta', 350000n),
      lead('novo', 280000n),
      lead('reuniao', 900000n),
      lead('espera', 220000n),
      lead('ganho', 280000n),
      lead('contato', 280000n),
    ])
    expect(r.emAndamento).toBe(7)
    // 2800+2800+3500+2800+9000+2800 = 23.700 (espera e ganho fora)
    expect(r.potencial.centavos).toBe(2_370_000n)
    expect(r.conversaoDasEncerradas).toBe(100)
    expect(r.porEtapa.find((x) => x.etapa === 'novo')!.quantidade).toBe(2)
  })

  it('arquivado não conta em nada; perdido entra só na conversão', () => {
    const r = resumoDasOportunidades([
      lead('proposta', 100n, true),
      lead('perdido', 999n),
      lead('ganho', 500n),
      lead('contato', null),
    ])
    expect(r.emAndamento).toBe(1)
    expect(r.potencial.centavos).toBe(0n)
    expect(r.conversaoDasEncerradas).toBe(50)
    expect(r.porEtapa.reduce((s, x) => s + x.quantidade, 0)).toBe(3)
  })

  it('propriedade: potencial = soma exata dos valores das etapas abertas (exceto espera), em centavos', () => {
    const etapa = fc.constantFrom(...ETAPAS_DO_LEAD)
    fc.assert(
      fc.property(
        fc.array(fc.record({ etapa, c: fc.option(fc.bigInt({ min: 0n, max: 10n ** 12n })), arq: fc.boolean() })),
        (xs) => {
          const r = resumoDasOportunidades(xs.map((x) => lead(x.etapa, x.c, x.arq)))
          const esperado = xs
            .filter((x) => !x.arq && !['ganho', 'perdido', 'espera'].includes(x.etapa))
            .reduce((s, x) => s + (x.c ?? 0n), 0n)
          expect(r.potencial.centavos).toBe(esperado)
          expect(r.porEtapa.reduce((s, x) => s + x.quantidade, 0)).toBe(xs.filter((x) => !x.arq).length)
        },
      ),
    )
  })
})

describe('sinalDoLead — L2422-2435', () => {
  it('lead fechado nunca tem sinal', () => {
    expect(sinalDoLead({ ...base, etapa: 'ganho' }, HOJE)).toBeNull()
    expect(sinalDoLead({ ...base, etapa: 'perdido' }, HOJE)).toBeNull()
  })

  it('A37: lead que pediu para não ser contatado nunca é recomendado', () => {
    expect(sinalDoLead({ ...base, proximoContato: dia(-3), naoContatar: true }, HOJE)).toBeNull()
  })

  it('contato combinado vencido: agora, com a data dd/mm; roteiro de confirmação se reunião', () => {
    const s = sinalDoLead({ ...base, etapa: 'reuniao', proximoContato: dia(-2) }, HOJE)!
    expect(s.nivel).toBe('agora')
    expect(s.motivo).toBe('O contato estava combinado para 06/11.')
    expect(s.roteiro).toBe('confirmacao')
    const r = sinalDoLead({ ...base, etapa: 'proposta', proximoContato: dia(-2) }, HOJE)!
    expect(r.roteiro).toBe('retomada')
  })

  it('contato combinado para hoje: agora, roteiro pela etapa', () => {
    const s = sinalDoLead({ ...base, etapa: 'proposta', proximoContato: HOJE }, HOJE)!
    expect(s).toMatchObject({ nivel: 'agora', motivo: 'Contato combinado para hoje.', roteiro: 'proposta' })
    expect(sinalDoLead({ ...base, etapa: 'espera', proximoContato: HOJE }, HOJE)!.roteiro).toBe('retomada')
  })

  it('indicação nova sem contato: hoje até 1 dia, agora com 2 dias ou mais ("Indicação esfria rápido")', () => {
    const nova = { ...base, etapa: 'novo' as const, ultimoContato: null }
    expect(sinalDoLead({ ...nova, recebidaEm: dia(-1) }, HOJE)!.nivel).toBe('hoje')
    const s = sinalDoLead({ ...nova, recebidaEm: dia(-2) }, HOJE)!
    expect(s.nivel).toBe('agora')
    expect(s.motivo).toBe('Indicação recebida há 2 dias e ainda sem contato. Indicação esfria rápido.')
    expect(s.roteiro).toBe('primeiro')
  })

  it('proposta: 5 dias sem retorno é agora; 3 dias é esta semana; 2 dias é nada', () => {
    const p = { ...base, etapa: 'proposta' as const }
    expect(sinalDoLead({ ...p, ultimoContato: dia(-5) }, HOJE)!.nivel).toBe('agora')
    expect(sinalDoLead({ ...p, ultimoContato: dia(-3) }, HOJE)!.nivel).toBe('semana')
    expect(sinalDoLead({ ...p, ultimoContato: dia(-2) }, HOJE)).toBeNull()
  })

  it('contato/reunião parados 10 dias sem próximo passo: esta semana', () => {
    const s = sinalDoLead({ ...base, ultimoContato: dia(-10) }, HOJE)!
    expect(s.nivel).toBe('semana')
    expect(s.roteiro).toBe('agendar')
    expect(sinalDoLead({ ...base, ultimoContato: dia(-10), proximoContato: dia(3) }, HOJE)).toBeNull()
  })

  it('peso: agora 30, hoje 20, semana 10, +5 quente, +3 indicação de cliente (×10 dos pesos do protótipo)', () => {
    const s = sinalDoLead(
      { ...base, proximoContato: dia(-1), temperatura: 'quente', indicadoPorCliente: true },
      HOJE,
    )!
    expect(s.peso).toBe(38)
    expect(s.motivo.endsWith('Indicação de cliente da carteira: vale prioridade.')).toBe(true)
  })

  it('caso do protótipo l5 (reunião amanhã): sem sinal; l6 (espera, combinado ontem): agora', () => {
    expect(
      sinalDoLead({ ...base, etapa: 'reuniao', proximoContato: dia(1), ultimoContato: dia(-6) }, HOJE),
    ).toBeNull()
    expect(
      sinalDoLead({ ...base, etapa: 'espera', proximoContato: dia(-1), ultimoContato: dia(-55) }, HOJE)!.nivel,
    ).toBe('agora')
  })
})

describe('registrar contato — L2559-2565', () => {
  it('etapa sugerida depois do contato: novo e espera vão para contato; o resto fica', () => {
    expect(etapaSugeridaDepoisDoContato('novo')).toBe('contato')
    expect(etapaSugeridaDepoisDoContato('espera')).toBe('contato')
    expect(etapaSugeridaDepoisDoContato('reuniao')).toBe('reuniao')
    expect(etapaSugeridaDepoisDoContato('proposta')).toBe('proposta')
  })

  it('próximo contato sugerido: 5 dias para proposta, 7 para o resto', () => {
    expect(proximoContatoSugerido('proposta', HOJE)).toBe(dia(5))
    expect(proximoContatoSugerido('contato', HOJE)).toBe(dia(7))
  })

  const caso = {
    etapaAtual: 'contato' as EtapaDoLead,
    etapaDepois: 'reuniao' as EtapaDoLead,
    data: HOJE,
    hoje: HOJE,
    naoContatar: false,
    nota: 'Conversamos.',
  }

  it('aceita o caso comum', () => {
    expect(ehOk(validarRegistroDeContato(caso))).toBe(true)
  })

  it('A37: recusa contato com quem pediu para não ser contatado', () => {
    const r = validarRegistroDeContato({ ...caso, naoContatar: true })
    expect(ehErro(r) && r.erro.codigo).toBe('NAO_CONTATAR')
  })

  it('recusa data futura (regra 24: o hoje é do servidor)', () => {
    const r = validarRegistroDeContato({ ...caso, data: dia(1) })
    expect(ehErro(r) && r.erro.codigo).toBe('DATA_FUTURA')
  })

  it('"ganho" nunca passa por aqui — a conversão tem caminho próprio', () => {
    const r = validarRegistroDeContato({ ...caso, etapaDepois: 'ganho' })
    expect(ehErro(r) && r.erro.codigo).toBe('GANHO_PELA_CONVERSAO')
  })

  it('lead fechado registra contato só sem mudar a etapa', () => {
    expect(ehOk(validarRegistroDeContato({ ...caso, etapaAtual: 'perdido', etapaDepois: 'perdido' }))).toBe(true)
    const r = validarRegistroDeContato({ ...caso, etapaAtual: 'perdido', etapaDepois: 'contato' })
    expect(ehErro(r) && r.erro.codigo).toBe('ETAPA_TERMINAL')
  })
})

describe('decidirPerda — L2960 ("tentar de novo em" move para Em espera)', () => {
  it('sem data: perdido', () => {
    const r = decidirPerda('Fechou com outro.', null, HOJE)
    expect(ehOk(r) && r.valor).toEqual({ etapa: 'perdido', proximoContato: null })
  })
  it('com data: espera, com o próximo contato', () => {
    const r = decidirPerda('Sem orçamento agora.', dia(60), HOJE)
    expect(ehOk(r) && r.valor).toEqual({ etapa: 'espera', proximoContato: dia(60) })
  })
  it('motivo é obrigatório; tentar de novo no passado é recusado', () => {
    expect(ehErro(decidirPerda('  ', null, HOJE))).toBe(true)
    expect(ehErro(decidirPerda('x', dia(-1), HOJE))).toBe(true)
  })
})

describe('quem indicou e o ranking — L2533-2548', () => {
  it('quemIndicou: o cliente da carteira ganha do texto livre (indNome, L2437)', () => {
    expect(quemIndicou({ nomeDoClienteIndicador: 'Clínica X', indicadoPor: 'Fulano' })).toBe('Clínica X')
    expect(quemIndicou({ nomeDoClienteIndicador: null, indicadoPor: '  João  ' })).toBe('João')
    expect(quemIndicou({ nomeDoClienteIndicador: null, indicadoPor: ' ' })).toBeNull()
  })

  const L = (
    id: string,
    etapa: EtapaDoLead,
    cli: string | null,
    nomeCli: string | null,
    por: string | null,
    arquivado = false,
  ): LeadParaRanking => ({
    id,
    nome: `Dra. ${id}`,
    etapa,
    arquivado,
    clienteIndicadorId: cli,
    nomeDoClienteIndicador: nomeCli,
    indicadoPor: por,
  })

  it('caso do protótipo: c1 indicou 2 (1 ganho) e lidera; pessoas agrupam sem diferenciar caixa', () => {
    const rank = rankingDeQuemIndica(
      [
        L('l1', 'contato', null, null, 'João (Castellum)'),
        L('l2', 'novo', 'c1', 'Raphaella', 'Dra. Raphaella Pontes'),
        L('l4', 'novo', 'c6', 'Bruna', null),
        L('l5', 'reuniao', null, null, 'Marcelo'),
        L('l8', 'ganho', 'c1', 'Raphaella', null),
        L('l7', 'contato', 'c3', 'Carol', null),
        L('l9', 'perdido', null, null, 'marcelo'),
        L('l3', 'proposta', null, null, null),
      ],
      [{ leadComercialId: 'l8', situacao: 'pendente' }],
    )
    expect(rank[0]).toMatchObject({
      nome: 'Raphaella',
      clienteCarteiraId: 'c1',
      total: 2,
      emAndamento: 1,
      viraramClientes: 1,
      indicacoesQueViraramCliente: 50,
      beneficiosPendentes: 1,
      beneficiosConcedidos: 0,
    })
    const marcelo = rank.find((x) => x.chave === 'p:marcelo')!
    expect(marcelo).toMatchObject({ total: 2, emAndamento: 1, viraramClientes: 0, indicacoesQueViraramCliente: 0 })
    expect(rank.some((x) => x.leads.some((l) => l.id === 'l3'))).toBe(false) // sem indicação, fora
  })

  it('arquivado fica fora do ranking', () => {
    expect(rankingDeQuemIndica([L('a', 'ganho', 'c1', 'X', null, true)], [])).toEqual([])
  })

  it('propriedade: soma dos totais = leads indicados não arquivados; ordem por ganhos e depois total', () => {
    const lead = fc.record({
      etapa: fc.constantFrom(...ETAPAS_DO_LEAD),
      quem: fc.constantFrom('c1', 'c2', 'Ana', 'ana', 'Bia', null),
      arquivado: fc.boolean(),
    })
    fc.assert(
      fc.property(fc.array(lead, { maxLength: 40 }), (xs) => {
        const leads = xs.map((x, i) => {
          const cliente = x.quem !== null && x.quem.startsWith('c')
          return L(`l${i}`, x.etapa, cliente ? x.quem : null, cliente ? `Cli ${x.quem}` : null, cliente ? null : x.quem, x.arquivado)
        })
        const rank = rankingDeQuemIndica(leads, [])
        expect(rank.reduce((s, r) => s + r.total, 0)).toBe(xs.filter((x) => x.quem !== null && !x.arquivado).length)
        for (const r of rank) expect(r.emAndamento + r.viraramClientes).toBeLessThanOrEqual(r.total)
        for (let i = 1; i < rank.length; i++) {
          const a = rank[i - 1]!
          const b = rank[i]!
          expect(
            a.viraramClientes > b.viraramClientes || (a.viraramClientes === b.viraramClientes && a.total >= b.total),
          ).toBe(true)
        }
      }),
    )
  })
})

describe('situacaoDoBeneficio — D-22 item 11', () => {
  it('sem cliente: guardado até a pessoa virar cliente', () => {
    expect(situacaoDoBeneficio({ clienteCarteiraId: null, consumidoEm: null })).toBe('guardado')
  })
  it('com cliente, não consumido: pendente; consumido pela cobrança: concedido', () => {
    expect(situacaoDoBeneficio({ clienteCarteiraId: 'c', consumidoEm: null })).toBe('pendente')
    expect(situacaoDoBeneficio({ clienteCarteiraId: 'c', consumidoEm: '2026-11-01T00:00:00Z' })).toBe('concedido')
  })
})

describe('telefone do lead — fone() e waHref, L2420/L2447', () => {
  it('só dígitos, com 55 quando tem até 11 dígitos', () => {
    expect(normalizarTelefoneDoLead('(71) 99999-1201')).toBe('5571999991201')
    expect(normalizarTelefoneDoLead('+55 71 99999-1201')).toBe('5571999991201')
    expect(normalizarTelefoneDoLead('')).toBeNull()
    expect(normalizarTelefoneDoLead(null)).toBeNull()
  })
  it('menos de 10 dígitos não é telefone (o fone() do protótipo transformava "0" em "550")', () => {
    expect(normalizarTelefoneDoLead('0')).toBeNull()
    expect(normalizarTelefoneDoLead('9999-1201')).toBeNull()
  })
  it('o link do WhatsApp não leva texto — a mensagem pronta é do ticket 3A', () => {
    expect(linkDoWhatsApp('(71) 99999-1201')).toBe('https://wa.me/5571999991201')
    expect(linkDoWhatsApp('abc')).toBeNull()
  })
  it('propriedade: normalizar é idempotente', () => {
    fc.assert(
      fc.property(fc.string(), (t) => {
        const n = normalizarTelefoneDoLead(t)
        if (n !== null) expect(normalizarTelefoneDoLead(n)).toBe(n)
      }),
    )
  })
})

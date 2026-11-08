import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  aniversariosProximos,
  aplicaRotinaAoCliente,
  cargaDaPessoa,
  cargaPorCliente,
  cumprimentoNoPrazo,
  datasDaRotina,
  destinoPodeReceberTarefa,
  diaDaSemanaIso,
  ehDiaUtil,
  lembretesDeVencimento,
  mensagemDeAniversario,
  nEsimoDiaUtil,
  ordemDoDiaUtil,
  planejarTarefasDaRotina,
  proximaDataDaRotina,
  proximaDaRecorrencia,
  proximaOcorrenciaDoAniversario,
  recuarParaDiaUtil,
  ROTINAS_PADRAO,
  secaoDaTarefa,
  semanasDaCarga,
  tarefaEntraNaRedistribuicao,
  textoDaFrequencia,
  validarParametrosDaRotina,
  vencimentoNoMes,
  type ClienteParaRotina,
  type RotinaParaPlanejar,
} from './calendario-carteira'
import { segundaDaSemana } from './metas-carteira'
import { diasEntre, fimDoMes, somarDias } from './relogio'
import { ehErro } from './resultado'

/* Geradores: dias civis entre 2020 e 2035 — inclui três fevereiros bissextos. */
const BASE = '2020-01-01'
const umDia = fc.integer({ min: 0, max: 365 * 15 }).map((n) => somarDias(BASE, n))
const umMes = fc
  .tuple(fc.integer({ min: 2020, max: 2035 }), fc.integer({ min: 1, max: 12 }))
  .map(([a, m]) => `${a}-${String(m).padStart(2, '0')}`)

const rotina = (o: Partial<RotinaParaPlanejar> = {}): RotinaParaPlanejar => ({
  id: 'r1',
  frequencia: 'semanal',
  escopoAplicacao: 'global',
  diaSemana: 1,
  diaUtil: 1,
  antecedencia: 3,
  servico: null,
  quemExecuta: 'responsavel_da_rotina',
  responsavelId: 'u-rotina',
  inicio: '2026-01-01',
  frentes: false,
  envio: false,
  ...o,
})

const cliente = (o: Partial<ClienteParaRotina> = {}): ClienteParaRotina => ({
  id: 'c1',
  nome: 'Clínica Um',
  status: 'ativo',
  inicio: '2025-01-01',
  reunioesInicio: null,
  reuniaoDiaSemana: null,
  diaVencimento: null,
  temMensalidade: false,
  servicos: [],
  temMetaEmAndamento: false,
  responsavelId: null,
  ...o,
})

describe('calendário — dia da semana e dia útil', () => {
  it('2026-11-08 é domingo, 2026-11-09 é segunda', () => {
    expect(diaDaSemanaIso('2026-11-08')).toBe(7)
    expect(diaDaSemanaIso('2026-11-09')).toBe(1)
    expect(ehDiaUtil('2026-11-08')).toBe(false)
    expect(ehDiaUtil('2026-11-09')).toBe(true)
  })

  it('PROPRIEDADE (T-11): segundaDaSemana(d) é segunda, <= d e > d − 7 — a semana começa na segunda', () => {
    fc.assert(
      fc.property(umDia, (d) => {
        const s = segundaDaSemana(d)
        expect(diaDaSemanaIso(s)).toBe(1)
        expect(s <= d).toBe(true)
        expect(diasEntre(s, d)).toBeLessThan(7)
      }),
    )
  })

  it('PROPRIEDADE: recuarParaDiaUtil nunca cai no fim de semana, nunca avança e recua no máximo 2 dias', () => {
    fc.assert(
      fc.property(umDia, (d) => {
        const r = recuarParaDiaUtil(d)
        expect(ehDiaUtil(r)).toBe(true)
        expect(r <= d).toBe(true)
        expect(diasEntre(r, d)).toBeLessThanOrEqual(2)
        if (ehDiaUtil(d)) expect(r).toBe(d)
      }),
    )
  })
})

describe('N-ésimo dia útil do mês', () => {
  it('novembro de 2026: 1º dia útil é segunda 02/11, 3º é 04/11, 21º é 30/11, não há 22º', () => {
    expect(nEsimoDiaUtil('2026-11', 1)).toBe('2026-11-02')
    expect(nEsimoDiaUtil('2026-11', 3)).toBe('2026-11-04')
    expect(nEsimoDiaUtil('2026-11', 21)).toBe('2026-11-30')
    expect(nEsimoDiaUtil('2026-11', 22)).toBeNull()
  })

  it('mês que começa no sábado: o 1º dia útil é a segunda seguinte (agosto de 2026)', () => {
    expect(nEsimoDiaUtil('2026-08', 1)).toBe('2026-08-03')
    expect(nEsimoDiaUtil('2026-08', 2)).toBe('2026-08-04')
  })

  it('PROPRIEDADE: o N-ésimo dia útil é dia útil, do mês certo, e tem exatamente N−1 dias úteis antes dele no mês', () => {
    fc.assert(
      fc.property(umMes, fc.integer({ min: 1, max: 23 }), (mes, n) => {
        const d = nEsimoDiaUtil(mes, n)
        if (d === null) {
          // Só falta quando o mês não tem N dias úteis.
          let uteis = 0
          for (let x = `${mes}-01`; x <= fimDoMes(mes); x = somarDias(x, 1)) if (ehDiaUtil(x)) uteis++
          expect(uteis).toBeLessThan(n)
          return
        }
        expect(d.slice(0, 7)).toBe(mes)
        expect(ehDiaUtil(d)).toBe(true)
        expect(ordemDoDiaUtil(d)).toBe(n)
        let antes = 0
        for (let x = `${mes}-01`; x < d; x = somarDias(x, 1)) if (ehDiaUtil(x)) antes++
        expect(antes).toBe(n - 1)
      }),
    )
  })

  it('PROPRIEDADE: ordemDoDiaUtil e nEsimoDiaUtil são inversas', () => {
    fc.assert(
      fc.property(umDia, (d) => {
        const n = ordemDoDiaUtil(d)
        if (!ehDiaUtil(d)) expect(n).toBeNull()
        else expect(nEsimoDiaUtil(d.slice(0, 7), n!)).toBe(d)
      }),
    )
  })
})

describe('regra 25 — vencimento em dia 29, 30 ou 31 cai no último dia do mês curto', () => {
  it('casos que doem', () => {
    expect(vencimentoNoMes('2026-02', 31)).toBe('2026-02-28')
    expect(vencimentoNoMes('2028-02', 30)).toBe('2028-02-29')
    expect(vencimentoNoMes('2026-04', 31)).toBe('2026-04-30')
    expect(vencimentoNoMes('2026-03', 31)).toBe('2026-03-31')
  })

  it('PROPRIEDADE: vencimento = min(dia, último dia do mês), sempre dentro do mês', () => {
    fc.assert(
      fc.property(umMes, fc.integer({ min: 1, max: 31 }), (mes, dia) => {
        const v = vencimentoNoMes(mes, dia)
        const ultimo = Number(fimDoMes(mes).slice(8, 10))
        expect(v.slice(0, 7)).toBe(mes)
        expect(Number(v.slice(8, 10))).toBe(Math.min(dia, ultimo))
      }),
    )
  })
})

describe('lembretes de vencimento (R11, $3, ajuste 38)', () => {
  it('vencimento 01/03/2026 (domingo), 3 dias antes: 26/02 (quinta), competência março', () => {
    const l = lembretesDeVencimento(1, 3, '2026-02-20', '2026-03-10')
    expect(l).toContainEqual({ data: '2026-02-26', vencimento: '2026-03-01', competencia: '2026-03-01' })
  })

  it('vencimento no dia 31 em fevereiro de 2026 vence 28/02 (sábado); o lembrete 3 dias antes cai em 25/02', () => {
    const l = lembretesDeVencimento(31, 3, '2026-02-01', '2026-03-01')
    expect(l).toEqual([{ data: '2026-02-25', vencimento: '2026-02-28', competencia: '2026-02-01' }])
  })

  it('lembrete que cairia no sábado recua para a sexta', () => {
    // vencimento 10/11/2026 (terça), 3 dias antes = 07/11 (sábado) → 06/11 (sexta).
    const l = lembretesDeVencimento(10, 3, '2026-11-01', '2026-11-20')
    expect(l).toEqual([{ data: '2026-11-06', vencimento: '2026-11-10', competencia: '2026-11-01' }])
  })

  it('PROPRIEDADE: todo lembrete é dia útil, dentro da janela [de, até), <= vencimento, e a competência é o mês do vencimento', () => {
    fc.assert(
      fc.property(umDia, fc.integer({ min: 1, max: 60 }), fc.integer({ min: 1, max: 31 }), fc.integer({ min: 0, max: 15 }), (de, largura, dia, ant) => {
        const ate = somarDias(de, largura)
        const ls = lembretesDeVencimento(dia, ant, de, ate)
        for (const l of ls) {
          expect(ehDiaUtil(l.data)).toBe(true)
          expect(l.data >= de && l.data < ate).toBe(true)
          expect(l.data <= l.vencimento).toBe(true)
          expect(l.competencia).toBe(`${l.vencimento.slice(0, 7)}-01`)
          expect(l.vencimento).toBe(vencimentoNoMes(l.vencimento.slice(0, 7), dia))
        }
        // Uma competência só uma vez — a chave de idempotência (ajuste 38).
        expect(new Set(ls.map((l) => l.competencia)).size).toBe(ls.length)
      }),
    )
  })

  it('PROPRIEDADE: cortar a janela em duas não perde nem duplica lembrete', () => {
    fc.assert(
      fc.property(umDia, fc.integer({ min: 0, max: 40 }), fc.integer({ min: 0, max: 40 }), fc.integer({ min: 1, max: 31 }), fc.integer({ min: 0, max: 10 }), (de, a, b, dia, ant) => {
        const meio = somarDias(de, a)
        const ate = somarDias(meio, b)
        const tudo = lembretesDeVencimento(dia, ant, de, ate)
        const partes = [...lembretesDeVencimento(dia, ant, de, meio), ...lembretesDeVencimento(dia, ant, meio, ate)]
        expect(partes).toEqual(tudo)
      }),
    )
  })
})

describe('datasDaRotina — as três frequências de calendário', () => {
  it('diária só em dias úteis (semana de 09/11/2026)', () => {
    expect(datasDaRotina({ frequencia: 'diaria', diaSemana: null, diaUtil: null }, '2026-11-07', '2026-11-15')).toEqual([
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
    ])
  })

  it('semanal no dia escolhido (sexta)', () => {
    expect(datasDaRotina({ frequencia: 'semanal', diaSemana: 5, diaUtil: null }, '2026-11-01', '2026-11-30')).toEqual([
      '2026-11-06',
      '2026-11-13',
      '2026-11-20',
      '2026-11-27',
    ])
  })

  it('mensal no 2º dia útil', () => {
    expect(datasDaRotina({ frequencia: 'mensal', diaSemana: null, diaUtil: 2 }, '2026-10-15', '2027-01-15')).toEqual([
      '2026-11-03',
      '2026-12-02',
      '2027-01-04', // 01/01/2027 é sexta (feriado ignorado, como no protótipo)
    ])
  })

  it('PROPRIEDADE: janela semiaberta — cortar em duas dá a mesma lista, sem repetir a borda', () => {
    const params = fc.oneof(
      fc.constant({ frequencia: 'diaria' as const, diaSemana: null, diaUtil: null }),
      fc.integer({ min: 1, max: 7 }).map((d) => ({ frequencia: 'semanal' as const, diaSemana: d, diaUtil: null })),
      fc.integer({ min: 1, max: 23 }).map((n) => ({ frequencia: 'mensal' as const, diaSemana: null, diaUtil: n })),
    )
    fc.assert(
      fc.property(params, umDia, fc.integer({ min: 0, max: 60 }), fc.integer({ min: 0, max: 60 }), (p, de, a, b) => {
        const meio = somarDias(de, a)
        const ate = somarDias(meio, b)
        expect([...datasDaRotina(p, de, meio), ...datasDaRotina(p, meio, ate)]).toEqual(datasDaRotina(p, de, ate))
      }),
    )
  })

  it('PROPRIEDADE: diária nunca no fim de semana; semanal sempre no dia pedido; mensal sempre o N-ésimo útil', () => {
    fc.assert(
      fc.property(umDia, fc.integer({ min: 1, max: 7 }), fc.integer({ min: 1, max: 23 }), (de, ds, n) => {
        const ate = somarDias(de, 70)
        for (const d of datasDaRotina({ frequencia: 'diaria', diaSemana: null, diaUtil: null }, de, ate)) expect(ehDiaUtil(d)).toBe(true)
        for (const d of datasDaRotina({ frequencia: 'semanal', diaSemana: ds, diaUtil: null }, de, ate)) expect(diaDaSemanaIso(d)).toBe(ds)
        for (const d of datasDaRotina({ frequencia: 'mensal', diaSemana: null, diaUtil: n }, de, ate)) expect(ordemDoDiaUtil(d)).toBe(n)
      }),
    )
  })
})

describe('textoDaFrequencia (freqTxt, L870-876)', () => {
  it('os cinco textos', () => {
    expect(textoDaFrequencia(rotina({ frequencia: 'vencimento', antecedencia: 3 }))).toBe('3 dias antes do vencimento de cada cliente')
    expect(textoDaFrequencia(rotina({ frequencia: 'reuniao' }))).toBe('No dia da reunião fixa de cada cliente')
    expect(textoDaFrequencia(rotina({ frequencia: 'diaria' }))).toBe('Todo dia útil')
    expect(textoDaFrequencia(rotina({ frequencia: 'semanal', diaSemana: 5 }))).toBe('Toda sexta')
    expect(textoDaFrequencia(rotina({ frequencia: 'mensal', diaUtil: 2 }))).toBe('Todo 2º dia útil do mês')
  })
})

describe('validarParametrosDaRotina', () => {
  it('vencimento e reunião exigem uma tarefa por cliente', () => {
    expect(ehErro(validarParametrosDaRotina({ ...rotina({ frequencia: 'vencimento', escopoAplicacao: 'global' }) }))).toBe(true)
    expect(ehErro(validarParametrosDaRotina({ ...rotina({ frequencia: 'reuniao', escopoAplicacao: 'lista' }) }))).toBe(true)
    expect(ehErro(validarParametrosDaRotina({ ...rotina({ frequencia: 'reuniao', escopoAplicacao: 'por_cliente' }) }))).toBe(false)
  })
  it('semanal sem dia da semana e mensal sem dia útil são recusados', () => {
    expect(ehErro(validarParametrosDaRotina(rotina({ frequencia: 'semanal', diaSemana: null })))).toBe(true)
    expect(ehErro(validarParametrosDaRotina(rotina({ frequencia: 'mensal', diaUtil: null })))).toBe(true)
  })
  it('frentes e envio só com uma por cliente', () => {
    expect(ehErro(validarParametrosDaRotina(rotina({ frentes: true, escopoAplicacao: 'global' })))).toBe(true)
  })
})

describe('aplicaRotinaAoCliente (aplica, L877-883)', () => {
  it('só ativo ou onboarding', () => {
    expect(aplicaRotinaAoCliente(rotina(), cliente({ status: 'pausado' }))).toBe(false)
    expect(aplicaRotinaAoCliente(rotina(), cliente({ status: 'encerrado' }))).toBe(false)
    expect(aplicaRotinaAoCliente(rotina(), cliente({ status: 'onboarding' }))).toBe(true)
  })
  it('serviço: fluxo exige o serviço; pagamento exige vencimento e mensalidade; metas exige reunião ou meta em andamento', () => {
    expect(aplicaRotinaAoCliente(rotina({ servico: 'fluxo' }), cliente({ servicos: ['dre'] }))).toBe(false)
    expect(aplicaRotinaAoCliente(rotina({ servico: 'fluxo' }), cliente({ servicos: ['fluxo'] }))).toBe(true)
    expect(aplicaRotinaAoCliente(rotina({ servico: 'pagamento' }), cliente({ diaVencimento: 10, temMensalidade: false }))).toBe(false)
    expect(aplicaRotinaAoCliente(rotina({ servico: 'pagamento' }), cliente({ diaVencimento: 10, temMensalidade: true }))).toBe(true)
    expect(aplicaRotinaAoCliente(rotina({ servico: 'metas' }), cliente())).toBe(false)
    expect(aplicaRotinaAoCliente(rotina({ servico: 'metas' }), cliente({ reuniaoDiaSemana: 2 }))).toBe(true)
    expect(aplicaRotinaAoCliente(rotina({ servico: 'metas' }), cliente({ temMetaEmAndamento: true }))).toBe(true)
  })
})

describe('planejarTarefasDaRotina (gerarRotinas, L894-917)', () => {
  const HOJE = '2026-11-08' // domingo

  it('diária global: 7 dias à frente, só úteis', () => {
    const p = planejarTarefasDaRotina(rotina({ frequencia: 'diaria' }), [], HOJE)
    expect(p.map((t) => t.prazo)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'])
    expect(p.every((t) => t.clienteId === null && t.responsavelId === 'u-rotina')).toBe(true)
  })

  it('nunca gera antes do início da rotina', () => {
    const p = planejarTarefasDaRotina(rotina({ frequencia: 'diaria', inicio: '2026-11-12' }), [], HOJE)
    expect(p.map((t) => t.prazo)).toEqual(['2026-11-12', '2026-11-13'])
  })

  it('com lista de clientes: UMA tarefa por data, com um item por cliente a que se aplica', () => {
    const p = planejarTarefasDaRotina(
      rotina({ frequencia: 'semanal', diaSemana: 3, escopoAplicacao: 'lista', servico: 'semanal' }),
      [cliente({ id: 'a', nome: 'A', servicos: ['semanal'] }), cliente({ id: 'b', nome: 'B' })],
      HOJE,
    )
    expect(p).toHaveLength(1)
    expect(p[0]!.itens).toEqual([{ rotulo: 'A', clienteId: 'a', frente: null }])
  })

  it('uma por cliente com frentes: quatro itens, um por frente', () => {
    const p = planejarTarefasDaRotina(
      rotina({ frequencia: 'semanal', diaSemana: 1, escopoAplicacao: 'por_cliente', frentes: true }),
      [cliente()],
      HOJE,
    )
    expect(p).toHaveLength(1)
    expect(p[0]!.itens.map((i) => i.frente)).toEqual(['financeiro', 'comercial', 'trafego', 'marketing'])
  })

  it('vencimento: 35 dias à frente, por cliente com mensalidade e dia de vencimento; competência é do vencimento', () => {
    const p = planejarTarefasDaRotina(
      rotina({ frequencia: 'vencimento', escopoAplicacao: 'por_cliente', servico: 'pagamento', antecedencia: 3 }),
      [cliente({ diaVencimento: 10, temMensalidade: true }), cliente({ id: 'sem', diaVencimento: null, temMensalidade: true })],
      HOJE,
    )
    expect(p).toEqual([
      expect.objectContaining({ prazo: '2026-12-07', clienteId: 'c1', vencimento: '2026-12-10', competencia: '2026-12-01' }),
    ])
  })

  it('reunião: no dia da reunião fixa, a partir de reunioes_inicio; cliente sem reunião fixa e sem meta não gera', () => {
    const p = planejarTarefasDaRotina(
      rotina({ frequencia: 'reuniao', escopoAplicacao: 'por_cliente', servico: 'metas' }),
      [
        cliente({ id: 'ter', reuniaoDiaSemana: 2, reunioesInicio: '2026-11-11' }),
        cliente({ id: 'qui', reuniaoDiaSemana: 4 }),
        cliente({ id: 'nada' }),
      ],
      HOJE,
    )
    expect(p.map((t) => [t.clienteId, t.prazo])).toEqual([['qui', '2026-11-12']])
  })

  it('reunião sem dia fixo mas com meta em andamento cai na segunda (diaReuniao, L749)', () => {
    const p = planejarTarefasDaRotina(
      rotina({ frequencia: 'reuniao', escopoAplicacao: 'por_cliente', servico: 'metas' }),
      [cliente({ temMetaEmAndamento: true })],
      HOJE,
    )
    expect(p.map((t) => t.prazo)).toEqual(['2026-11-09'])
  })

  it('quem executa: responsável do cliente, com a da rotina quando o cliente não tem', () => {
    const p = planejarTarefasDaRotina(
      rotina({ frequencia: 'semanal', diaSemana: 1, escopoAplicacao: 'por_cliente', quemExecuta: 'responsavel_do_cliente' }),
      [cliente({ id: 'a', responsavelId: 'u-a' }), cliente({ id: 'b' })],
      HOJE,
    )
    expect(p.map((t) => [t.clienteId, t.responsavelId])).toEqual([
      ['a', 'u-a'],
      ['b', 'u-rotina'],
    ])
  })

  it('cliente que entrou depois de hoje só gera a partir da entrada', () => {
    const p = planejarTarefasDaRotina(
      rotina({ frequencia: 'diaria', escopoAplicacao: 'por_cliente' }),
      [cliente({ inicio: '2026-11-12' })],
      HOJE,
    )
    expect(p.map((t) => t.prazo)).toEqual(['2026-11-12', '2026-11-13'])
  })

  it('PROPRIEDADE: planejar é função pura — mesma entrada, mesma saída (base da idempotência do job)', () => {
    fc.assert(
      fc.property(umDia, fc.constantFrom('diaria', 'semanal', 'mensal'), (hoje, f) => {
        const r = rotina({ frequencia: f as 'diaria', escopoAplicacao: 'por_cliente' })
        const cs = [cliente(), cliente({ id: 'c2' })]
        expect(planejarTarefasDaRotina(r, cs, hoje)).toEqual(planejarTarefasDaRotina(r, cs, hoje))
      }),
    )
  })
})

describe('próxima data e % no prazo (R9)', () => {
  it('próxima de uma semanal', () => {
    expect(proximaDataDaRotina(rotina({ frequencia: 'semanal', diaSemana: 5 }), [], '2026-11-08')).toBe('2026-11-13')
  })
  it('próxima de vencimento é a menor entre os clientes', () => {
    const r = rotina({ frequencia: 'vencimento', escopoAplicacao: 'por_cliente', servico: 'pagamento', antecedencia: 0 })
    const cs = [cliente({ id: 'a', diaVencimento: 20, temMensalidade: true }), cliente({ id: 'b', diaVencimento: 12, temMensalidade: true })]
    expect(proximaDataDaRotina(r, cs, '2026-11-08')).toBe('2026-11-12')
  })
  it('% no prazo das últimas 8 vencidas; concluída depois do prazo não conta; sem histórico é null', () => {
    const t = (prazo: string, concluidaNoDia: string | null) => ({ prazo, status: concluidaNoDia ? ('concluida' as const) : ('pendente' as const), concluidaNoDia })
    expect(cumprimentoNoPrazo([], '2026-11-08')).toBeNull()
    expect(
      cumprimentoNoPrazo([t('2026-11-02', '2026-11-02'), t('2026-11-03', '2026-11-04'), t('2026-11-04', null), t('2026-11-09', null)], '2026-11-08'),
    ).toBe(33)
    const dez = Array.from({ length: 10 }, (_, i) => t(somarDias('2026-10-01', i), i < 2 ? null : somarDias('2026-10-01', i)))
    expect(cumprimentoNoPrazo(dez, '2026-11-08')).toBe(100)
  })
})

describe('seções da lista de tarefas (R1)', () => {
  it('vencidas, hoje, próximos 7 dias, mais adiante', () => {
    expect(secaoDaTarefa('2026-11-07', '2026-11-08')).toBe('vencidas')
    expect(secaoDaTarefa('2026-11-08', '2026-11-08')).toBe('hoje')
    expect(secaoDaTarefa('2026-11-15', '2026-11-08')).toBe('proximos7')
    expect(secaoDaTarefa('2026-11-16', '2026-11-08')).toBe('adiante')
  })
})

describe('recorrência de tarefa (R3, regra 25)', () => {
  it('diária, semanal, mensal com 31 → último dia do mês curto', () => {
    expect(proximaDaRecorrencia('2026-11-08', 'diaria')).toBe('2026-11-09')
    expect(proximaDaRecorrencia('2026-11-08', 'semanal')).toBe('2026-11-15')
    expect(proximaDaRecorrencia('2026-01-31', 'mensal')).toBe('2026-02-28')
    expect(proximaDaRecorrencia('2026-11-08', 'nenhuma')).toBeNull()
  })
})

describe('carga da equipe (R7)', () => {
  const HOJE = '2026-11-11' // quarta
  it('quatro semanas de segunda a domingo, a primeira contendo hoje, janelas semiabertas encostadas', () => {
    const s = semanasDaCarga(HOJE)
    expect(s.map((x) => x.inicio)).toEqual(['2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'])
    for (let i = 0; i < 3; i++) expect(s[i]!.fimExclusivo).toBe(s[i + 1]!.inicio)
  })

  it('atrasadas à parte; esta semana conta só de hoje em diante; composição por tipo', () => {
    const c = cargaDaPessoa(
      [
        { prazo: '2026-11-09', tipo: 'avulsa', clienteId: null },
        { prazo: '2026-11-11', tipo: 'rotina', clienteId: 'a' },
        { prazo: '2026-11-15', tipo: 'reuniao', clienteId: 'a' },
        { prazo: '2026-11-20', tipo: 'avulsa', clienteId: 'b' },
        { prazo: '2026-12-30', tipo: 'avulsa', clienteId: 'b' },
      ],
      HOJE,
    )
    expect(c.atrasadas.total).toBe(1)
    expect(c.semanas.map((s) => s.total)).toEqual([2, 1, 0, 0])
    expect(c.semanas[0]!.porTipo).toEqual({ checklist: 0, rotina: 1, reuniao: 1, avulsa: 0 })
  })

  it('por cliente: só atrasadas e as quatro semanas, ordenado pelo total; "Interno" é clienteId null', () => {
    const l = cargaPorCliente(
      [
        { prazo: '2026-11-09', tipo: 'avulsa', clienteId: null },
        { prazo: '2026-11-12', tipo: 'rotina', clienteId: 'a' },
        { prazo: '2026-11-13', tipo: 'rotina', clienteId: 'a' },
        { prazo: '2027-03-01', tipo: 'avulsa', clienteId: 'b' },
      ],
      HOJE,
    )
    expect(l).toEqual([
      { clienteId: 'a', total: 2, atrasadas: 0, porTipo: { checklist: 0, rotina: 2, reuniao: 0, avulsa: 0 } },
      { clienteId: null, total: 1, atrasadas: 1, porTipo: { checklist: 0, rotina: 0, reuniao: 0, avulsa: 1 } },
    ])
  })

  it('PROPRIEDADE: nenhuma tarefa é contada duas vezes — atrasadas + semanas <= total de tarefas', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -40, max: 60 }), { maxLength: 40 }), (offs) => {
        const ts = offs.map((o) => ({ prazo: somarDias(HOJE, o), tipo: 'avulsa' as const, clienteId: null }))
        const c = cargaDaPessoa(ts, HOJE)
        const soma = c.atrasadas.total + c.semanas.reduce((s, x) => s + x.total, 0)
        expect(soma).toBe(ts.filter((t) => t.prazo < somarDias(segundaDaSemana(HOJE), 28)).length)
      }),
    )
  })
})

describe('redistribuir (R8)', () => {
  const t = (o: Partial<{ tipo: 'checklist' | 'rotina' | 'reuniao' | 'avulsa'; clienteId: string | null; prazo: string }>) => ({
    tipo: 'avulsa' as const,
    clienteId: null,
    prazo: '2026-11-10',
    ...o,
  })
  it('rotinas nunca se movem aqui', () => {
    expect(tarefaEntraNaRedistribuicao(t({ tipo: 'rotina' }), { tipo: 'todas', clienteId: null, desde: null })).toBe(false)
  })
  it('"só checklist", "só avulsas e reunião", cliente e prazo a partir de', () => {
    expect(tarefaEntraNaRedistribuicao(t({ tipo: 'checklist' }), { tipo: 'checklist', clienteId: null, desde: null })).toBe(true)
    expect(tarefaEntraNaRedistribuicao(t({ tipo: 'reuniao' }), { tipo: 'checklist', clienteId: null, desde: null })).toBe(false)
    expect(tarefaEntraNaRedistribuicao(t({ tipo: 'reuniao' }), { tipo: 'avulsa', clienteId: null, desde: null })).toBe(true)
    expect(tarefaEntraNaRedistribuicao(t({ clienteId: 'a' }), { tipo: 'todas', clienteId: 'b', desde: null })).toBe(false)
    expect(tarefaEntraNaRedistribuicao(t({ prazo: '2026-11-01' }), { tipo: 'todas', clienteId: null, desde: '2026-11-05' })).toBe(false)
  })
})

describe('aniversários (P6, LGPD A45–A47)', () => {
  it('hoje, amanhã, e a virada do ano', () => {
    expect(proximaOcorrenciaDoAniversario(8, 11, '2026-11-08')).toEqual({ data: '2026-11-08', emDias: 0 })
    expect(proximaOcorrenciaDoAniversario(9, 11, '2026-11-08')).toEqual({ data: '2026-11-09', emDias: 1 })
    expect(proximaOcorrenciaDoAniversario(2, 1, '2026-12-30')).toEqual({ data: '2027-01-02', emDias: 3 })
    expect(proximaOcorrenciaDoAniversario(7, 11, '2026-11-08').data).toBe('2027-11-07')
  })

  it('29/02 em ano comum é lembrado em 28/02', () => {
    expect(proximaOcorrenciaDoAniversario(29, 2, '2027-02-20')).toEqual({ data: '2027-02-28', emDias: 8 })
    expect(proximaOcorrenciaDoAniversario(29, 2, '2028-02-20').data).toBe('2028-02-29')
  })

  it('janela de 7 dias inclui hoje e o 7º dia, ordenada pelo mais próximo; nenhum campo de idade', () => {
    const l = aniversariosProximos(
      [
        { chave: 'x', dia: 15, mes: 11 },
        { chave: 'y', dia: 16, mes: 11 },
        { chave: 'z', dia: 8, mes: 11 },
      ],
      '2026-11-08',
      7,
    )
    expect(l.map((p) => p.chave)).toEqual(['z', 'x'])
    for (const p of l) expect(Object.keys(p)).not.toContain('idade')
  })

  it('PROPRIEDADE: a próxima ocorrência é >= hoje, < hoje + 367 e cai no dia/mês pedidos (salvo 29/02)', () => {
    fc.assert(
      fc.property(umDia, fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 31 }), (hoje, mes, dia) => {
        const ultimo = Number(fimDoMes(`2028-${String(mes).padStart(2, '0')}`).slice(8, 10))
        fc.pre(dia <= ultimo)
        const { data, emDias } = proximaOcorrenciaDoAniversario(dia, mes, hoje)
        expect(data >= hoje).toBe(true)
        expect(emDias).toBe(diasEntre(hoje, data))
        expect(emDias).toBeLessThan(367)
        expect(Number(data.slice(5, 7))).toBe(mes)
        if (!(dia === 29 && mes === 2)) expect(Number(data.slice(8, 10))).toBe(dia)
      }),
    )
  })

  it('a mensagem não carrega idade nem ano', () => {
    const m = mensagemDeAniversario('cliente', 'Dra. Ana Souza Lima')
    expect(m).toContain('Dra. Ana')
    expect(m).not.toMatch(/\d/)
    expect(mensagemDeAniversario('equipe', 'Beatriz Rocha')).toContain('Beatriz!')
  })
})

describe('rotinas padrão (R12, L848-857)', () => {
  it('as seis do protótipo, todas válidas', () => {
    expect(ROTINAS_PADRAO.map((r) => r.chave)).toEqual([
      'fluxo',
      'dre',
      'formularios',
      'validar_relatorio',
      'reuniao_metas',
      'lembrete_mensalidade',
    ])
    for (const r of ROTINAS_PADRAO) expect(ehErro(validarParametrosDaRotina(r))).toBe(false)
    const lembrete = ROTINAS_PADRAO.find((r) => r.chave === 'lembrete_mensalidade')!
    expect(lembrete).toMatchObject({ frequencia: 'vencimento', antecedencia: 3, prioridade: 'alta', mensagem: 'pagamento' })
  })
})

describe('destinoPodeReceberTarefa (R4, R8 — o destino enxerga a tarefa)', () => {
  it('geral recebe de qualquer grupo; grupo só do próprio; inativo nunca; tarefa da Firmare só para geral', () => {
    expect(destinoPodeReceberTarefa('g1', { escopo: 'geral', grupoId: null, ativo: true })).toBe(true)
    expect(destinoPodeReceberTarefa('g1', { escopo: 'grupo', grupoId: 'g1', ativo: true })).toBe(true)
    expect(destinoPodeReceberTarefa('g1', { escopo: 'grupo', grupoId: 'g2', ativo: true })).toBe(false)
    expect(destinoPodeReceberTarefa('g1', { escopo: 'grupo', grupoId: 'g1', ativo: false })).toBe(false)
    expect(destinoPodeReceberTarefa(null, { escopo: 'grupo', grupoId: 'g1', ativo: true })).toBe(false)
  })
})

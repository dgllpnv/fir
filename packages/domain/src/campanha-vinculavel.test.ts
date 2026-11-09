import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  aceitaVinculo,
  type CampanhaDeVinculo,
  campanhaSugerida,
  sugestaoDeCampanha,
  campanhasVinculaveis,
  conferirVinculo,
  DIAS_DE_VINCULO_DEPOIS_DO_FIM,
  emAndamento,
} from './campanha-vinculavel'
import { ehErro, ehOk } from './resultado'
import { diaCivil, instanteLocal, somarDias } from './relogio'

/**
 * A janela de vínculo da campanha (correções da PO, A3 · N-7, S-10).
 *
 * As datas da campanha são DIAS CIVIS fechados (`inicio <= dia <= fim`), e a
 * comparação é feita em instantes, na janela semiaberta
 * `[início(inicio), início(fim + 1))` no fuso DA CLÍNICA. As bordas que doem:
 * 23:30 em São Paulo já é o dia seguinte em UTC; Manaus está uma hora atrás.
 */

const SP = 'America/Sao_Paulo'
const MANAUS = 'America/Manaus'
const FUSOS = [SP, MANAUS, 'America/Bahia', 'America/Rio_Branco', 'America/Noronha'] as const

const camp = (
  id: string,
  inicio: string,
  fim: string,
  extra: Partial<CampanhaDeVinculo> = {},
): CampanhaDeVinculo => ({ id, nome: `Campanha ${id}`, inicio, fim, excluida: false, ...extra })

/** O instante de um relógio de parede na clínica. */
const as = (dia: string, hora: string, fuso: string): Date => instanteLocal(dia, hora, fuso)

describe('janela de vínculo — TAREFA e RECEBIMENTO: em andamento ou encerrada há até 30 dias', () => {
  const hoje = '2026-11-09'

  it('o limite `fim = hoje − 30` entra, e `hoje − 31` não entra', () => {
    const agora = as(hoje, '10:00', SP)
    expect(DIAS_DE_VINCULO_DEPOIS_DO_FIM).toBe(30)
    expect(aceitaVinculo(camp('a', '2026-09-01', somarDias(hoje, -30)), 'tarefa', agora, SP)).toBe(
      true,
    )
    expect(aceitaVinculo(camp('b', '2026-09-01', somarDias(hoje, -31)), 'tarefa', agora, SP)).toBe(
      false,
    )
  })

  it('às 23:30 de São Paulo (já é amanhã em UTC) a borda continua a do dia da CLÍNICA', () => {
    const agora = as(hoje, '23:30', SP)
    expect(agora.toISOString().slice(0, 10)).toBe('2026-11-10') // UTC já virou
    expect(aceitaVinculo(camp('a', '2026-09-01', somarDias(hoje, -30)), 'tarefa', agora, SP)).toBe(
      true,
    )
    // À meia-noite da clínica, sim, o dia virou — e a mesma campanha sai.
    const meiaNoite = as(somarDias(hoje, 1), '00:00', SP)
    expect(
      aceitaVinculo(camp('a', '2026-09-01', somarDias(hoje, -30)), 'tarefa', meiaNoite, SP),
    ).toBe(false)
  })

  it('o mesmo instante dá respostas diferentes em São Paulo e em Manaus', () => {
    // 00:30 de 10/11 em São Paulo = 23:30 de 09/11 em Manaus.
    const agora = as('2026-11-10', '00:30', SP)
    expect(diaCivil(agora, MANAUS)).toBe('2026-11-09')
    const c = camp('a', '2026-09-01', '2026-10-10') // 2026-11-09 − 30
    expect(aceitaVinculo(c, 'tarefa', agora, MANAUS)).toBe(true)
    expect(aceitaVinculo(c, 'tarefa', agora, SP)).toBe(false)
  })

  it('campanha FUTURA aceita vínculo de tarefa (o protótipo filtra só por `fim`)', () => {
    const agora = as(hoje, '10:00', SP)
    expect(aceitaVinculo(camp('f', '2026-12-01', '2026-12-31'), 'tarefa', agora, SP)).toBe(true)
  })

  it('campanha EXCLUÍDA nunca aceita vínculo novo, mesmo em andamento', () => {
    const agora = as(hoje, '10:00', SP)
    const c = camp('x', '2026-11-01', '2026-11-30', { excluida: true })
    expect(aceitaVinculo(c, 'tarefa', agora, SP)).toBe(false)
    expect(aceitaVinculo(c, 'paciente', agora, SP)).toBe(false)
  })

  it('virada de ano: fim em 31/12 entra até 30/01 e sai em 31/01', () => {
    const c = camp('v', '2026-12-01', '2026-12-31')
    expect(aceitaVinculo(c, 'tarefa', as('2027-01-30', '23:59', SP), SP)).toBe(true)
    expect(aceitaVinculo(c, 'tarefa', as('2027-01-31', '00:00', SP), SP)).toBe(false)
  })

  it('ano bissexto: fim em 29/02 entra até 30/03 (30 dias de calendário, não "um mês")', () => {
    const c = camp('b', '2028-02-01', '2028-02-29')
    expect(aceitaVinculo(c, 'tarefa', as('2028-03-30', '12:00', SP), SP)).toBe(true)
    expect(aceitaVinculo(c, 'tarefa', as('2028-03-31', '12:00', SP), SP)).toBe(false)
  })
})

describe('janela de vínculo — PACIENTE: só as ativas hoje', () => {
  it('campanha encerrada ONTEM é recusada (AB-A3-4)', () => {
    const agora = as('2026-11-09', '09:00', SP)
    expect(aceitaVinculo(camp('o', '2026-10-01', '2026-11-08'), 'paciente', agora, SP)).toBe(false)
    expect(aceitaVinculo(camp('o', '2026-10-01', '2026-11-08'), 'tarefa', agora, SP)).toBe(true)
  })

  it('o último dia inteiro conta, até 23:59 da clínica — e 00:00 do dia seguinte não', () => {
    const c = camp('u', '2026-11-01', '2026-11-09')
    for (const fuso of [SP, MANAUS]) {
      expect(aceitaVinculo(c, 'paciente', as('2026-11-09', '23:30', fuso), fuso)).toBe(true)
      expect(aceitaVinculo(c, 'paciente', as('2026-11-10', '00:00', fuso), fuso)).toBe(false)
    }
  })

  it('o primeiro dia começa à meia-noite da clínica, não à meia-noite UTC', () => {
    const c = camp('p', '2026-11-10', '2026-11-30')
    // 22:00 de 09/11 em São Paulo já é 10/11 em UTC — e a campanha ainda não começou.
    expect(aceitaVinculo(c, 'paciente', as('2026-11-09', '22:00', SP), SP)).toBe(false)
    expect(aceitaVinculo(c, 'paciente', as('2026-11-10', '00:00', SP), SP)).toBe(true)
  })

  it('campanha futura não é "ativa hoje"', () => {
    const agora = as('2026-11-09', '09:00', SP)
    expect(aceitaVinculo(camp('f', '2026-12-01', '2026-12-31'), 'paciente', agora, SP)).toBe(false)
  })
})

describe('a janela em instantes é EXATAMENTE a comparação de dias civis da clínica', () => {
  // Gera dias de 2025 a 2029 e instantes em qualquer hora do dia.
  const dia = fc
    .integer({ min: 0, max: 365 * 5 })
    .map((n) => somarDias('2025-01-01', n))
  const instante = fc
    .integer({ min: Date.UTC(2025, 0, 1), max: Date.UTC(2030, 0, 1) })
    .map((ms) => new Date(ms))

  it('tarefa: aceita ⇔ fim >= hoje − 30; paciente: aceita ⇔ inicio <= hoje <= fim', () => {
    fc.assert(
      fc.property(
        dia,
        fc.integer({ min: 0, max: 90 }),
        instante,
        fc.constantFrom(...FUSOS),
        (inicio, duracao, agora, fuso) => {
          const fim = somarDias(inicio, duracao)
          const c = camp('c', inicio, fim)
          const hoje = diaCivil(agora, fuso)
          expect(aceitaVinculo(c, 'tarefa', agora, fuso)).toBe(fim >= somarDias(hoje, -30))
          expect(aceitaVinculo(c, 'paciente', agora, fuso)).toBe(inicio <= hoje && hoje <= fim)
          // `emAndamento` (a situação da tela de Campanhas) é a MESMA janela,
          // e não liga para exclusão — a pergunta é sobre as datas.
          expect(emAndamento(c, agora, fuso)).toBe(inicio <= hoje && hoje <= fim)
          expect(emAndamento({ inicio, fim }, agora, fuso)).toBe(
            aceitaVinculo({ ...c, excluida: false }, 'paciente', agora, fuso),
          )
        },
      ),
      { numRuns: 2000 },
    )
  })
})

describe('campanhasVinculaveis — a lista que a tela mostra', () => {
  const agora = as('2026-11-09', '10:00', SP)
  const todas = [
    camp('enc-10', '2026-09-01', '2026-10-30'), // encerrada há 10 dias
    camp('and-velha', '2026-10-01', '2026-11-30'), // em andamento, começou antes
    camp('enc-40', '2026-08-01', '2026-09-30'), // encerrada há 40 dias
    camp('and-nova', '2026-11-05', '2026-11-20'), // em andamento, começou depois
    camp('fut', '2026-12-01', '2026-12-31'), // futura
    camp('exc', '2026-11-01', '2026-11-30', { excluida: true }),
  ]

  it('tarefa: em andamento primeiro (mais recente antes), depois o resto por início', () => {
    expect(campanhasVinculaveis(todas, 'tarefa', agora, SP).map((x) => x.id)).toEqual([
      'and-nova',
      'and-velha',
      'fut',
      'enc-10',
    ])
  })

  it('paciente: só as em andamento hoje', () => {
    expect(campanhasVinculaveis(todas, 'paciente', agora, SP).map((x) => x.id)).toEqual([
      'and-nova',
      'and-velha',
    ])
  })

  it('a saída tem só `id` e `nome` — nunca datas, meta ou receita', () => {
    for (const x of campanhasVinculaveis(todas, 'tarefa', agora, SP)) {
      expect(Object.keys(x).sort()).toEqual(['id', 'nome'])
    }
  })

  it('`incluir` acrescenta a campanha ATUAL mesmo encerrada há 40 dias ou excluída (N-4)', () => {
    expect(
      campanhasVinculaveis(todas, 'tarefa', agora, SP, 'enc-40').map((x) => x.id),
    ).toContain('enc-40')
    expect(campanhasVinculaveis(todas, 'tarefa', agora, SP, 'exc').map((x) => x.id)).toContain(
      'exc',
    )
    // E não duplica a que já estava.
    const ids = campanhasVinculaveis(todas, 'tarefa', agora, SP, 'and-nova').map((x) => x.id)
    expect(ids.filter((x) => x === 'and-nova')).toHaveLength(1)
  })

  it('empate de início ordena pelo nome', () => {
    const lista = campanhasVinculaveis(
      [
        { ...camp('z', '2026-11-01', '2026-11-30'), nome: 'Zênite' },
        { ...camp('a', '2026-11-01', '2026-11-30'), nome: 'Abril' },
      ],
      'tarefa',
      agora,
      SP,
    )
    expect(lista.map((x) => x.nome)).toEqual(['Abril', 'Zênite'])
  })
})

describe('conferirVinculo — a validação da ESCRITA usa a mesma janela da lista', () => {
  const agora = as('2026-11-09', '10:00', SP)

  it('inexistente, de outra clínica (a RLS devolve nada) e excluída dão o MESMO erro (S-11)', () => {
    const nada = conferirVinculo(undefined, 'tarefa', agora, SP)
    const excluida = conferirVinculo(
      camp('x', '2026-11-01', '2026-11-30', { excluida: true }),
      'tarefa',
      agora,
      SP,
    )
    expect(ehErro(nada) && ehErro(excluida)).toBe(true)
    if (ehErro(nada) && ehErro(excluida)) expect(excluida.erro).toEqual(nada.erro)
  })

  it('encerrada há 31 dias é recusada (AB-A3-3); há 30, aceita', () => {
    expect(ehErro(conferirVinculo(camp('v', '2026-09-01', '2026-10-09'), 'tarefa', agora, SP))).toBe(
      true,
    )
    expect(ehOk(conferirVinculo(camp('v', '2026-09-01', '2026-10-10'), 'tarefa', agora, SP))).toBe(
      true,
    )
  })

  it('a campanha ATUAL é aceita mesmo excluída ou antiga: editar sem mexer não a perde (N-4)', () => {
    const velha = camp('v', '2026-01-01', '2026-01-31', { excluida: true })
    expect(ehOk(conferirVinculo(velha, 'tarefa', agora, SP, 'v'))).toBe(true)
    // Mas só ela: outra antiga continua recusada.
    expect(ehErro(conferirVinculo(velha, 'tarefa', agora, SP, 'outra'))).toBe(true)
  })

  it('paciente com campanha encerrada ontem: recusado; em andamento: aceito', () => {
    expect(
      ehErro(conferirVinculo(camp('o', '2026-10-01', '2026-11-08'), 'paciente', agora, SP)),
    ).toBe(true)
    expect(
      ehOk(conferirVinculo(camp('o', '2026-10-01', '2026-11-09'), 'paciente', agora, SP)),
    ).toBe(true)
  })

  it('a lista e a validação nunca divergem (propriedade)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -120, max: 60 }),
        fc.integer({ min: 0, max: 60 }),
        fc.boolean(),
        fc.constantFrom('tarefa' as const, 'paciente' as const),
        fc.constantFrom(...FUSOS),
        (desloc, duracao, excluida, contexto, fuso) => {
          const hoje = diaCivil(agora, fuso)
          const inicio = somarDias(hoje, desloc)
          const c = camp('c', inicio, somarDias(inicio, duracao), { excluida })
          const naLista = campanhasVinculaveis([c], contexto, agora, fuso).length === 1
          expect(ehOk(conferirVinculo(c, contexto, agora, fuso))).toBe(naLista)
        },
      ),
      { numRuns: 1000 },
    )
  })
})

describe('campanhaSugerida — `campanhaDoPaciente` do protótipo (L2820)', () => {
  const agora = as('2026-11-09', '10:00', SP)
  const ativa = camp('ativa', '2026-11-01', '2026-11-30')
  const outra = camp('outra', '2026-11-05', '2026-11-30')
  const encerrada = camp('enc', '2026-10-01', '2026-10-31')
  const todas = [ativa, outra, encerrada]

  it('a campanha por onde a paciente CHEGOU, se ativa hoje', () => {
    expect(campanhaSugerida('ativa', [], todas, agora, SP)).toBe('ativa')
  })

  it('sem origem ativa, a campanha da tarefa MAIS RECENTE dela que esteja ativa', () => {
    const tarefas = [
      { campanhaId: 'ativa', criadaEm: '2026-11-02T10:00:00.000Z' },
      { campanhaId: 'outra', criadaEm: '2026-11-06T10:00:00.000Z' },
      { campanhaId: 'enc', criadaEm: '2026-11-08T10:00:00.000Z' },
    ]
    expect(campanhaSugerida('enc', tarefas, todas, agora, SP)).toBe('outra')
  })

  it('nada ativo: nenhuma sugestão', () => {
    expect(campanhaSugerida('enc', [], todas, agora, SP)).toBeNull()
    expect(campanhaSugerida(null, [], todas, agora, SP)).toBeNull()
  })

  it('campanha excluída não é sugerida', () => {
    const exc = camp('exc', '2026-11-01', '2026-11-30', { excluida: true })
    expect(campanhaSugerida('exc', [], [exc], agora, SP)).toBeNull()
  })
})

describe('sugestaoDeCampanha — a sugestão com o porquê (L-A3-9)', () => {
  const agora = as('2026-11-09', '10:00', SP)
  const ativa = camp('ativa', '2026-11-01', '2026-11-30')
  const encerrada = camp('enc', '2026-10-01', '2026-10-31')
  const todas = [ativa, encerrada]

  it('origem ativa: motivo "origem"', () => {
    expect(sugestaoDeCampanha('ativa', [], todas, agora, SP)).toEqual({ sugerida: 'ativa', motivo: 'origem' })
  })

  it('origem ativa e também numa tarefa: continua "origem"', () => {
    const tarefas = [{ campanhaId: 'ativa', criadaEm: '2026-11-08T10:00:00.000Z' }]
    expect(sugestaoDeCampanha('ativa', tarefas, todas, agora, SP).motivo).toBe('origem')
  })

  it('origem encerrada e tarefa ativa: motivo "tarefa"', () => {
    const tarefas = [{ campanhaId: 'ativa', criadaEm: '2026-11-08T10:00:00.000Z' }]
    expect(sugestaoDeCampanha('enc', tarefas, todas, agora, SP)).toEqual({ sugerida: 'ativa', motivo: 'tarefa' })
  })

  it('nada ativo: os dois null — a origem encerrada não atravessa', () => {
    expect(sugestaoDeCampanha('enc', [], todas, agora, SP)).toEqual({ sugerida: null, motivo: null })
  })

  it('o id sugerido é sempre o de campanhaSugerida (propriedade)', () => {
    const ids = ['ativa', 'enc', 'x'] as const
    fc.assert(
      fc.property(
        fc.option(fc.constantFrom(...ids), { nil: null }),
        fc.array(
          fc.record({
            campanhaId: fc.constantFrom(...ids),
            criadaEm: fc.constantFrom('2026-11-01T00:00:00.000Z', '2026-11-05T00:00:00.000Z'),
          }),
          { maxLength: 4 },
        ),
        (origem, tarefas) => {
          const r = sugestaoDeCampanha(origem, tarefas, todas, agora, SP)
          expect(r.sugerida).toBe(campanhaSugerida(origem, tarefas, todas, agora, SP))
          expect(r.motivo === null).toBe(r.sugerida === null)
          if (r.motivo === 'origem') expect(r.sugerida).toBe(origem)
        },
      ),
    )
  })
})

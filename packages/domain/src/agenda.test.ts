import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  type CartaoDaAgenda,
  dadosDoCompromisso,
  decidirPelaAgenda,
  finalDoTelefone,
  mesmoTelefone,
  motivoParaIgnorar,
  PALAVRAS_PARA_IGNORAR_PADRAO,
  podeConsiderarRemocoes,
  telefoneNacional,
  tipoDoCompromisso,
  urlDaAgenda,
  urlMascarada,
} from './agenda'
import { ETAPAS, type Etapa } from './jornada'

const HOJE = '2026-11-10'
const AMANHA = '2026-11-11'
const ONTEM = '2026-11-09'

describe('telefone', () => {
  it('tira 55, zero e formatação', () => {
    expect(telefoneNacional('+55 (71) 99999-0000')).toBe('71999990000')
    expect(telefoneNacional('0 71 3333-4444')).toBe('7133334444')
    expect(telefoneNacional('(55) 3333-4444')).toBe('5533334444') // DDD 55 não é comido
  })

  it('casa o mesmo celular com e sem o nono dígito', () => {
    expect(mesmoTelefone('71 99999-0000', '+55 71 9999-0000')).toBe(true)
    expect(mesmoTelefone('7199990000', '71999990000')).toBe(true)
  })

  it('não casa DDD diferente nem número sem DDD', () => {
    expect(mesmoTelefone('71999990000', '11999990000')).toBe(false)
    expect(mesmoTelefone('99990000', '99990000')).toBe(false)
  })

  it('property: a formatação não muda o resultado, e a relação é simétrica', () => {
    const numero = fc.tuple(
      fc.integer({ min: 11, max: 99 }),
      fc.boolean(),
      fc.stringMatching(/^[2-9]\d{7}$/),
    )
    fc.assert(
      fc.property(numero, numero, fc.boolean(), ([ddd, nono, resto], outro, formatar) => {
        const a = `${ddd}${nono ? '9' : ''}${resto}`
        const fmt = formatar ? `+55 (${ddd}) ${nono ? '9' : ''}${resto.slice(0, 4)}-${resto.slice(4)}` : a
        expect(mesmoTelefone(a, fmt)).toBe(true)
        const b = `${outro[0]}${outro[1] ? '9' : ''}${outro[2]}`
        expect(mesmoTelefone(a, b)).toBe(mesmoTelefone(b, a))
      }),
    )
  })

  it('final de 8 dígitos para o pré-filtro, só com DDD', () => {
    expect(finalDoTelefone('(71) 99999-0000')).toBe('99990000')
    expect(finalDoTelefone('9999-0000')).toBeNull()
  })
})

describe('dados do compromisso', () => {
  const de = (titulo: string, descricao = '', procs: string[] = []) =>
    dadosDoCompromisso({ titulo, descricao }, procs)

  it.each([
    ['Maria Silva - Consulta', 'Maria Silva'],
    ['Consulta - Maria Silva', 'Maria Silva'],
    ['Maria Silva | Retorno', 'Maria Silva'],
    ['Maria Silva (71) 99999-0000', 'Maria Silva'],
    ['João Dória', 'João Dória'],
    ['Avaliação: Ana Paula Souza', 'Ana Paula Souza'],
    ['Dra. Carla - Ana Paula', 'Ana Paula'],
    ['Botox facial - Lúcia', 'Lúcia'],
  ])('%s → %s', (titulo, nome) => {
    expect(de(titulo, '', ['Botox facial']).nome).toBe(nome)
  })

  it('nome com hífen continua inteiro', () => {
    expect(de('Ana-Clara Souza').nome).toBe('Ana-Clara Souza')
    expect(de('Ana-Clara Souza - Consulta').nome).toBe('Ana-Clara Souza')
  })

  it('campo rotulado na descrição vence o título', () => {
    const d = de('Consulta 14h', 'Paciente: Rosa Lima\nTelefone: (71) 98888-7777')
    expect(d).toEqual({ nome: 'Rosa Lima', telefone: '71988887777' })
  })

  it('telefone vem do título quando não há rótulo', () => {
    expect(de('Rosa Lima 71988887777').telefone).toBe('71988887777')
  })

  it('sem letra nenhuma não há nome', () => {
    expect(de('Consulta').nome).toBeNull()
    expect(de('(71) 99999-0000').nome).toBeNull()
  })
})

describe('tipo do compromisso', () => {
  it('procedimento pela palavra ou pelo catálogo, palavra inteira', () => {
    const t = (titulo: string) => tipoDoCompromisso({ titulo, descricao: '' }, ['Botox', 'Lipo'])
    expect(t('Maria - Procedimento')).toBe('Procedimento agendado')
    expect(t('Maria - botox')).toBe('Procedimento agendado')
    expect(t('Maria - Lipoaspiração')).toBe('Consulta agendada')
    expect(t('Maria - Consulta')).toBe('Consulta agendada')
  })
})

describe('o que é ignorado', () => {
  const ign = (titulo: string, diaInteiro = false) =>
    motivoParaIgnorar({ titulo, descricao: '', diaInteiro }, PALAVRAS_PARA_IGNORAR_PADRAO)

  it('dia inteiro, palavra da lista e sem nome', () => {
    expect(ign('Maria', true)).toBe('dia-inteiro')
    expect(ign('ALMOÇO')).toBe('palavra-ignorada')
    expect(ign('Bloqueio de agenda')).toBe('palavra-ignorada')
    expect(ign('Consulta')).toBe('sem-nome')
    expect(ign('Maria Silva - Consulta')).toBeNull()
  })
})

describe('decidirPelaAgenda', () => {
  const cartao = (x: Partial<CartaoDaAgenda> = {}): CartaoDaAgenda => ({
    etapa: 'agendado',
    excluido: false,
    prazo: AMANHA,
    hora: '14:00',
    ...x,
  })
  const comp = (dia = AMANHA, hora = '14:00', cancelado = false) => ({ dia, hora, cancelado })

  it('compromisso novo no futuro cria; cancelado, sumido ou passado não', () => {
    expect(decidirPelaAgenda(null, comp(), HOJE)).toEqual({ tipo: 'criar' })
    expect(decidirPelaAgenda(null, comp(HOJE), HOJE)).toEqual({ tipo: 'criar' })
    expect(decidirPelaAgenda(null, comp(AMANHA, '14:00', true), HOJE)).toEqual({ tipo: 'nada' })
    expect(decidirPelaAgenda(null, comp(ONTEM), HOJE)).toEqual({ tipo: 'nada' })
    expect(decidirPelaAgenda(null, null, HOJE)).toEqual({ tipo: 'nada' })
  })

  it('hora ou dia mudou → reagendar', () => {
    expect(decidirPelaAgenda(cartao(), comp(AMANHA, '15:30'), HOJE)).toEqual({
      tipo: 'reagendar',
      prazo: AMANHA,
      hora: '15:30',
    })
  })

  it('removido ou cancelado → desmarcar, inclusive confirmado', () => {
    expect(decidirPelaAgenda(cartao(), null, HOJE)).toEqual({ tipo: 'desmarcar', porque: 'removido' })
    expect(decidirPelaAgenda(cartao({ etapa: 'confirmado' }), comp(AMANHA, '14:00', true), HOJE)).toEqual({
      tipo: 'desmarcar',
      porque: 'cancelado',
    })
  })

  it('já passou: continua aberto, a agenda não mexe', () => {
    expect(decidirPelaAgenda(cartao({ prazo: ONTEM }), null, HOJE)).toEqual({ tipo: 'nada' })
    expect(decidirPelaAgenda(cartao({ prazo: ONTEM }), comp(AMANHA), HOJE)).toEqual({ tipo: 'nada' })
  })

  it('não move para o passado', () => {
    expect(decidirPelaAgenda(cartao(), comp(ONTEM), HOJE)).toEqual({ tipo: 'nada' })
  })

  it('property: o que a recepção fez à mão nunca é desfeito, e excluído nunca volta', () => {
    const manuais = ETAPAS.filter((e) => e !== 'agendado' && e !== 'confirmado')
    fc.assert(
      fc.property(
        fc.constantFrom<Etapa | null>(...manuais, null),
        fc.constantFrom<Etapa>('agendado', 'confirmado'),
        fc.option(
          fc.record({
            dia: fc.constantFrom(ONTEM, HOJE, AMANHA, '2026-12-01'),
            hora: fc.constantFrom('08:00', '14:00'),
            cancelado: fc.boolean(),
          }),
          { nil: null },
        ),
        (etapaManual, etapaDaAgenda, c) => {
          expect(decidirPelaAgenda(cartao({ etapa: etapaManual }), c, HOJE)).toEqual({ tipo: 'nada' })
          expect(decidirPelaAgenda(cartao({ etapa: etapaDaAgenda, excluido: true }), c, HOJE)).toEqual({
            tipo: 'nada',
          })
        },
      ),
    )
  })

  it('property: idempotente — depois de aplicar o reagendamento, a próxima leitura não faz nada', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(HOJE, AMANHA, '2026-12-01'),
        fc.constantFrom('08:00', '09:30', '14:00'),
        fc.constantFrom<Etapa>('agendado', 'confirmado'),
        (dia, hora, etapa) => {
          const a = decidirPelaAgenda(cartao({ etapa }), comp(dia, hora), HOJE)
          const depois =
            a.tipo === 'reagendar' ? cartao({ etapa: 'agendado', prazo: a.prazo, hora: a.hora }) : cartao({ etapa })
          expect(decidirPelaAgenda(depois, comp(dia, hora), HOJE)).toEqual({ tipo: 'nada' })
        },
      ),
    )
  })
})

describe('salvaguardas', () => {
  it('feed vazio com futuro conhecido não remove nada', () => {
    expect(podeConsiderarRemocoes(0, 5)).toBe(false)
    expect(podeConsiderarRemocoes(0, 0)).toBe(true)
    expect(podeConsiderarRemocoes(3, 5)).toBe(true)
  })

  it('webcal vira https; a máscara não revela o token', () => {
    expect(urlDaAgenda(' webcal://calendar.google.com/x/basic.ics ')).toBe(
      'https://calendar.google.com/x/basic.ics',
    )
    const m = urlMascarada('https://calendar.google.com/calendar/ical/abc%40g/private-SEGREDO123/basic.ics')
    expect(m).toBe('https://calendar.google.com/….ics')
    expect(m).not.toContain('SEGREDO')
  })
})

describe('horaCivil', () => {
  it('meia-noite é 00:00, e o fuso da clínica decide o dia e a hora', async () => {
    const { horaCivil, diaCivil } = await import('./relogio')
    const meiaNoite = new Date('2026-11-12T03:00:00Z')
    expect(horaCivil(meiaNoite, 'America/Bahia')).toBe('00:00')
    expect(diaCivil(meiaNoite, 'America/Bahia')).toBe('2026-11-12')
    expect(horaCivil(new Date('2026-11-12T17:05:00Z'), 'America/Manaus')).toBe('13:05')
  })
})

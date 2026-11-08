import { describe, expect, it } from 'vitest'
import { FeedInvalido, lerIcal } from './leitor-ical'

const FUSO = 'America/Bahia'
const JANELA = {
  de: new Date('2026-11-10T03:00:00Z'),
  ate: new Date('2027-01-09T03:00:00Z'),
  fuso: FUSO,
}

const cal = (...eventos: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//teste//PT', ...eventos, 'END:VCALENDAR'].join('\r\n')

const ev = (linhas: string[]) => ['BEGIN:VEVENT', ...linhas, 'END:VEVENT'].join('\r\n')

describe('lerIcal', () => {
  it('UTC, TZID IANA, TZID do Windows e hora flutuante caem no mesmo instante certo', () => {
    const r = lerIcal(
      cal(
        ev(['UID:a', 'DTSTART:20261112T170000Z', 'SUMMARY:Ana - Consulta']),
        ev(['UID:b', 'DTSTART;TZID=America/Sao_Paulo:20261112T140000', 'SUMMARY:Bia']),
        ev(['UID:c', 'DTSTART;TZID=E. South America Standard Time:20261112T140000', 'SUMMARY:Cris']),
        ev(['UID:d', 'DTSTART:20261112T140000', 'SUMMARY:Davi']),
        ev(['UID:e', 'DTSTART;TZID=/mozilla.org/20050126_1/America/Sao_Paulo:20261112T140000', 'SUMMARY:Eva']),
      ),
      JANELA,
    )
    const por = new Map(r.map((c) => [c.chave, c.inicio.toISOString()]))
    // 14:00 em UTC−3 = 17:00Z, nos cinco formatos.
    for (const k of ['a', 'b', 'c', 'd', 'e']) expect(por.get(k)).toBe('2026-11-12T17:00:00.000Z')
  })

  it('dia inteiro, cancelado, título e descrição', () => {
    const r = lerIcal(
      cal(
        ev(['UID:x', 'DTSTART;VALUE=DATE:20261115', 'SUMMARY:Feriado']),
        ev(['UID:y', 'DTSTART:20261116T120000Z', 'STATUS:CANCELLED', 'SUMMARY:Rosa', 'DESCRIPTION:Telefone: 71 98888-7777']),
      ),
      JANELA,
    )
    const x = r.find((c) => c.chave === 'x')!
    const y = r.find((c) => c.chave === 'y')!
    expect(x.diaInteiro).toBe(true)
    expect(y).toMatchObject({ cancelado: true, titulo: 'Rosa', descricao: 'Telefone: 71 98888-7777' })
  })

  it('não recorrente fora da janela continua no resultado (para não parecer removido)', () => {
    const r = lerIcal(cal(ev(['UID:longe', 'DTSTART:20270601T120000Z', 'SUMMARY:Lia'])), JANELA)
    expect(r.map((c) => c.chave)).toEqual(['longe'])
  })

  it('recorrente: expande só na janela, respeita EXDATE e as exceções', () => {
    const r = lerIcal(
      cal(
        ev([
          'UID:rec',
          'DTSTART;TZID=America/Bahia:20261102T090000',
          'RRULE:FREQ=WEEKLY;COUNT=6',
          'EXDATE;TZID=America/Bahia:20261116T090000',
          'SUMMARY:Sessão - Mara',
        ]),
        ev([
          'UID:rec',
          'RECURRENCE-ID;TZID=America/Bahia:20261123T090000',
          'DTSTART;TZID=America/Bahia:20261123T100000',
          'SUMMARY:Sessão - Mara',
        ]),
        ev([
          'UID:rec',
          'RECURRENCE-ID;TZID=America/Bahia:20261130T090000',
          'DTSTART;TZID=America/Bahia:20261130T090000',
          'STATUS:CANCELLED',
          'SUMMARY:Sessão - Mara',
        ]),
      ),
      JANELA,
    )
    // 02/11 e 09/11 ficam antes da janela; 16/11 é EXDATE; 23/11 movida; 30/11 cancelada; 07/12 normal.
    expect(r.map((c) => [c.inicio.toISOString(), c.cancelado, c.recorrente])).toEqual([
      ['2026-11-23T13:00:00.000Z', false, true],
      ['2026-11-30T12:00:00.000Z', true, true],
      ['2026-12-07T12:00:00.000Z', false, true],
    ])
    expect(new Set(r.map((c) => c.chave)).size).toBe(3)
    expect(r[0]!.chave.startsWith('rec|')).toBe(true)
  })

  it('a mesma entrada dá sempre as mesmas chaves (idempotência começa aqui)', () => {
    const texto = cal(ev(['UID:k', 'DTSTART:20261120T120000Z', 'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:Kiko']))
    expect(lerIcal(texto, JANELA).map((c) => c.chave)).toEqual(lerIcal(texto, JANELA).map((c) => c.chave))
  })

  it('texto que não é iCal é recusado com mensagem para a tela', () => {
    expect(() => lerIcal('<html>login</html>', JANELA)).toThrow(FeedInvalido)
  })
})

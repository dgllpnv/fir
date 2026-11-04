import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { diaCivil, fimDaSessaoDoBalcao, inicioDoDia, somarDias } from './relogio'

/**
 * A SESSÃO DO BALCÃO — P-1, decidida pelo dono: 12 horas, terminando no fim do
 * dia da clínica, com a pessoa reentrando uma vez por dia.
 *
 * O que estes testes precisam provar não é que a conta fecha: é que **cada dia
 * de trabalho começa com uma entrada**. É essa propriedade que faz a trilha de
 * auditoria atribuir a ação à pessoa certa — a sessão de 30 dias atribuía um
 * mês inteiro a quem entrou primeiro.
 *
 * Fusos escolhidos a dedo, não por gosto: `America/Bahia` não tem horário de
 * verão, `America/Sao_Paulo` tem o histórico dele, `Asia/Kathmandu` tem
 * deslocamento de 45 minutos, e `Pacific/Chatham` tem 12h45. O legado fixou
 * `America/Bahia` num `const`; o fuso é propriedade da clínica (regra 22).
 */
const FUSOS = [
  'America/Bahia',
  'America/Sao_Paulo',
  'America/Manaus',
  'Asia/Kathmandu',
  'Pacific/Chatham',
  'UTC',
] as const

const HORA = 60 * 60 * 1000

/** O instante UTC de um relógio de parede na clínica. */
const naClinica = (dia: string, hora: number, minuto: number, fuso: string): Date =>
  new Date(inicioDoDia(dia, fuso).getTime() + hora * HORA + minuto * 60 * 1000)

describe('a sessão do balcão termina no fim do dia da clínica', () => {
  it('quem entra às 8h trabalha até as 20h — o teto de 12 h, e ele cobre o expediente', () => {
    // **Qual das duas regras manda, medido e não suposto.** Para quem entra
    // ANTES do meio-dia o teto de 12 h vence, porque a meia-noite está a mais
    // de 12 h de distância: 8h + 12h = 20h. A clínica abre 8h e fecha 19h, e
    // o expediente cabe inteiro.
    //
    // A fronteira do DIA só passa a mandar depois do meio-dia, e é lá que ela
    // é necessária — ver o teste seguinte. Escrevi este teste esperando
    // meia-noite e ele reprovou; o código estava certo.
    const fuso = 'America/Bahia'
    const agora = naClinica('2026-11-04', 8, 0, fuso)
    const fim = fimDaSessaoDoBalcao(agora, fuso)

    expect(fim.getTime() - agora.getTime()).toBe(12 * HORA)
    expect(fim.getTime()).toBe(naClinica('2026-11-04', 20, 0, fuso).getTime())
    // E continua no MESMO dia de trabalho: nenhuma sessão da manhã alcança o
    // turno seguinte.
    expect(diaCivil(new Date(fim.getTime() - 1), fuso)).toBe('2026-11-04')
  })

  it('quem entra à tarde NÃO herda a madrugada seguinte', () => {
    // O defeito que um prazo deslizante de 12 h teria: entrar às 14h e ficar
    // logado até as 2h da manhã, com o turno da manhã seguinte herdando a
    // sessão da tarde anterior.
    const fuso = 'America/Sao_Paulo'
    const fim = fimDaSessaoDoBalcao(naClinica('2026-11-04', 14, 0, fuso), fuso)
    expect(fim.getTime()).toBe(inicioDoDia('2026-11-05', fuso).getTime())
  })

  it('TETO: quem entra pouco depois da meia-noite não ganha 24 horas', () => {
    const fuso = 'America/Bahia'
    const agora = naClinica('2026-11-04', 0, 1, fuso)
    const fim = fimDaSessaoDoBalcao(agora, fuso)
    expect(fim.getTime() - agora.getTime()).toBe(12 * HORA)
  })

  it('PISO: quem entra às 23h55 não é desconectado em cinco minutos', () => {
    const fuso = 'America/Bahia'
    const agora = naClinica('2026-11-04', 23, 55, fuso)
    const fim = fimDaSessaoDoBalcao(agora, fuso)
    expect(fim.getTime() - agora.getTime()).toBe(HORA)
  })

  it('o piso é o MÍNIMO, não um acréscimo: às 22h a sessão vale 2 horas', () => {
    // A asserção que distingue "piso" de "sempre mais uma hora". Sem ela, uma
    // implementação que somasse 1 h ao fim do dia passaria nos dois testes
    // acima e daria sessão até 1h da manhã todo dia.
    const fuso = 'America/Bahia'
    const agora = naClinica('2026-11-04', 22, 0, fuso)
    expect(fimDaSessaoDoBalcao(agora, fuso).getTime() - agora.getTime()).toBe(2 * HORA)
  })
})

describe('as invariantes, em qualquer fuso e qualquer instante', () => {
  const instante = fc.integer({ min: 1_760_000_000_000, max: 1_900_000_000_000 })
  const fuso = fc.constantFrom(...FUSOS)

  it('nunca passa de 12 horas, nunca é menos de 1 hora', () => {
    fc.assert(
      fc.property(instante, fuso, (ms, tz) => {
        const agora = new Date(ms)
        const dura = fimDaSessaoDoBalcao(agora, tz).getTime() - agora.getTime()
        expect(dura).toBeGreaterThanOrEqual(HORA)
        expect(dura).toBeLessThanOrEqual(12 * HORA)
      }),
      { numRuns: 600 },
    )
  })

  it('termina no fim do dia da clínica — ou no teto, ou no piso, nunca em outro lugar', () => {
    fc.assert(
      fc.property(instante, fuso, (ms, tz) => {
        const agora = new Date(ms)
        const fim = fimDaSessaoDoBalcao(agora, tz).getTime()
        const fimDoDia = inicioDoDia(somarDias(diaCivil(agora, tz), 1), tz).getTime()
        expect([fimDoDia, agora.getTime() + 12 * HORA, agora.getTime() + HORA]).toContain(fim)
      }),
      { numRuns: 600 },
    )
  })

  it('A PROPRIEDADE QUE IMPORTA: a sessão nunca atravessa dois fins de dia', () => {
    // É isto que faz "cada dia de trabalho começa com uma entrada". Se uma
    // sessão pudesse atravessar duas meia-noites, a atribuição voltaria a
    // cobrir mais de um turno — que é o defeito da sessão de 30 dias, só
    // menor.
    fc.assert(
      fc.property(instante, fuso, (ms, tz) => {
        const agora = new Date(ms)
        const fim = fimDaSessaoDoBalcao(agora, tz)
        const diaDeEntrada = diaCivil(agora, tz)
        // O último instante válido da sessão cai no dia da entrada ou no dia
        // seguinte — nunca dois dias depois.
        const ultimoValido = diaCivil(new Date(fim.getTime() - 1), tz)
        expect([diaDeEntrada, somarDias(diaDeEntrada, 1)]).toContain(ultimoValido)
      }),
      { numRuns: 600 },
    )
  })

  it('o resultado é sempre FUTURO — nenhuma sessão nasce vencida', () => {
    fc.assert(
      fc.property(instante, fuso, (ms, tz) => {
        const agora = new Date(ms)
        expect(fimDaSessaoDoBalcao(agora, tz).getTime()).toBeGreaterThan(agora.getTime())
      }),
      { numRuns: 400 },
    )
  })
})

describe('as bordas construídas à mão — gerador uniforme não acha fronteira', () => {
  // A lição medida neste projeto: um gerador uniforme sobre 4 meses de
  // instantes quase nunca cai exatamente numa virada de horário de verão nem
  // num minuto de meia-noite. Estes casos são construídos.

  it('a virada de horário de verão não encurta nem alonga além dos limites', () => {
    // Chatham vira 23:45 → 00:45 (deslocamento de 45 min sobre 12h).
    for (const fuso of ['America/Sao_Paulo', 'Pacific/Chatham', 'America/Santiago']) {
      for (const dia of ['2026-04-05', '2026-09-06', '2026-10-04', '2026-11-01']) {
        for (const hora of [0, 1, 2, 12, 22, 23]) {
          const agora = naClinica(dia, hora, 30, fuso)
          const dura = fimDaSessaoDoBalcao(agora, fuso).getTime() - agora.getTime()
          expect(dura, `${fuso} ${dia} ${hora}h`).toBeGreaterThanOrEqual(HORA)
          expect(dura, `${fuso} ${dia} ${hora}h`).toBeLessThanOrEqual(12 * HORA)
        }
      }
    }
  })

  it('exatamente à meia-noite da clínica, o teto manda', () => {
    for (const fuso of FUSOS) {
      const agora = inicioDoDia('2026-11-04', fuso)
      expect(fimDaSessaoDoBalcao(agora, fuso).getTime() - agora.getTime(), fuso).toBe(12 * HORA)
    }
  })

  it('exatamente no último milissegundo do dia, o piso manda', () => {
    for (const fuso of FUSOS) {
      const agora = new Date(inicioDoDia('2026-11-05', fuso).getTime() - 1)
      expect(fimDaSessaoDoBalcao(agora, fuso).getTime() - agora.getTime(), fuso).toBe(HORA)
    }
  })

  it('às 12h em ponto, o fim do dia e o teto empatam — e o resultado é o mesmo', () => {
    // A fronteira exata entre os dois braços do `min`. Um `<` escrito como
    // `<=` (ou o contrário) não muda nada aqui, e é por isso que este caso
    // existe: para que a troca não passe por correção.
    for (const fuso of ['America/Bahia', 'UTC']) {
      const agora = naClinica('2026-11-04', 12, 0, fuso)
      const fim = fimDaSessaoDoBalcao(agora, fuso)
      expect(fim.getTime()).toBe(inicioDoDia('2026-11-05', fuso).getTime())
      expect(fim.getTime() - agora.getTime(), fuso).toBe(12 * HORA)
    }
  })
})

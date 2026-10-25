import { somarDias } from '@fir/domain'
import { describe, expect, it } from 'vitest'
import {
  abreviacaoDoDia,
  diaEmTexto,
  linkDeWhatsApp,
  plural,
  rotuloDoDia,
  somarDiasNaTela,
} from './formato'

describe('datas da tela', () => {
  it('o dia civil vira dd/mm/aaaa sem passar por Date', () => {
    expect(diaEmTexto('2026-10-24')).toBe('24/10/2026')
  })

  it('o dia da semana NÃO depende do fuso de quem abre a tela', () => {
    // `new Date('2026-10-24')` é meia-noite UTC — 21h do dia 23 na Bahia — e
    // devolveria "Sex" para metade do planeta. 24/10/2026 é um sábado.
    expect(abreviacaoDoDia('2026-10-24')).toBe('Sáb')
    expect(abreviacaoDoDia('2026-10-19')).toBe('Seg')
  })

  it('"hoje" vem do SERVIDOR, não do relógio do navegador', () => {
    // Se o rótulo usasse `new Date()`, este teste mudaria de resultado todo
    // dia à meia-noite — e a tela mudaria antes da clínica.
    expect(rotuloDoDia('2026-10-24', '2026-10-24')).toBe('Hoje')
    expect(rotuloDoDia('2026-10-23', '2026-10-24')).toBe('Ontem')
    expect(rotuloDoDia('2026-10-25', '2026-10-24')).toBe('Amanhã')
    expect(rotuloDoDia('2026-10-20', '2026-10-24')).toBe('terça-feira, 20/10/2026')
  })

  it('a aritmética da tela é a MESMA do domínio — inclusive na virada do mês', () => {
    // Duas implementações da mesma conta é como elas divergem. Esta existe
    // para não arrastar `packages/domain` inteiro para o navegador, e este
    // teste é o preço de tê-la.
    for (const dia of ['2026-10-31', '2026-02-28', '2028-02-28', '2026-01-01', '2026-12-31']) {
      for (const n of [-7, -1, 0, 1, 7]) {
        expect(somarDiasNaTela(dia, n), `${dia} ${n}`).toBe(somarDias(dia, n))
      }
    }
  })
})

describe('link de WhatsApp', () => {
  it('acrescenta o 55 quando o número é DDD + celular', () => {
    expect(linkDeWhatsApp('(71) 98888-7777')).toBe('https://wa.me/5571988887777')
  })

  it('não inventa link para um ramal anotado no lugar do celular', () => {
    // Abrir conversa com quem não é a paciente é pior que não ter o botão.
    expect(linkDeWhatsApp('4410')).toBeNull()
    expect(linkDeWhatsApp('')).toBeNull()
    expect(linkDeWhatsApp(null)).toBeNull()
  })

  it('número que já veio com o código do país não ganha outro', () => {
    expect(linkDeWhatsApp('+55 71 98888-7777')).toBe('https://wa.me/5571988887777')
  })
})

describe('plural', () => {
  it('não escreve "tarefa(s)"', () => {
    expect(plural(1, 'tarefa em aberto', 'tarefas em aberto')).toBe('1 tarefa em aberto')
    expect(plural(6, 'tarefa em aberto', 'tarefas em aberto')).toBe('6 tarefas em aberto')
  })
})

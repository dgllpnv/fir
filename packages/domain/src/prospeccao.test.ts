import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ehErro, ehOk } from './resultado'
import {
  type EtapaDoLead,
  ETAPAS_DO_LEAD,
  etapaEhTerminal,
  podeEditarCheckinDaSemana,
  proximoPrazoDaRotina,
  resolverGrupoDeEscrita,
  roteiroDaEtapa,
  saudeAtualDoCliente,
  semanaIsoCivil,
  validarResponsavelDoMesmoGrupo,
  validarTransicaoDeEtapa,
} from './prospeccao'

describe('validarTransicaoDeEtapa', () => {
  it('recusa qualquer transição a partir de uma etapa terminal', () => {
    for (const de of ['ganho', 'perdido'] as const) {
      for (const para of ETAPAS_DO_LEAD) {
        const r = validarTransicaoDeEtapa(de, para, null)
        expect(ehErro(r)).toBe(true)
        if (ehErro(r)) expect(r.erro.codigo).toBe('ETAPA_TERMINAL')
      }
    }
  })

  it('perdido sem motivo é recusado', () => {
    const r = validarTransicaoDeEtapa('proposta', 'perdido', undefined)
    expect(ehErro(r)).toBe(true)
    if (ehErro(r)) expect(r.erro.codigo).toBe('MOTIVO_OBRIGATORIO')
  })

  it('perdido com motivo em branco é recusado', () => {
    const r = validarTransicaoDeEtapa('proposta', 'perdido', '   ')
    expect(ehErro(r)).toBe(true)
  })

  it('perdido com motivo de verdade é aceito', () => {
    const r = validarTransicaoDeEtapa('proposta', 'perdido', 'Foi para o concorrente.')
    expect(ehOk(r)).toBe(true)
  })

  it('avanço livre entre etapas não terminais é aceito', () => {
    const naoTerminais: EtapaDoLead[] = ['novo', 'contato', 'reuniao', 'proposta', 'espera']
    for (const de of naoTerminais) {
      for (const para of naoTerminais) {
        expect(ehOk(validarTransicaoDeEtapa(de, para, null))).toBe(true)
      }
    }
  })

  it('ganho é aceito sem motivo', () => {
    expect(ehOk(validarTransicaoDeEtapa('proposta', 'ganho', null))).toBe(true)
  })
})

describe('etapaEhTerminal', () => {
  it('só ganho e perdido são terminais', () => {
    for (const e of ETAPAS_DO_LEAD) {
      expect(etapaEhTerminal(e)).toBe(e === 'ganho' || e === 'perdido')
    }
  })
})

describe('resolverGrupoDeEscrita — ADR 0016 item 2, o achado crítico do gate', () => {
  it('escopo geral aceita qualquer grupo pedido, inclusive null', () => {
    const sessao = { escopo: 'geral' as const, grupoId: null }
    expect(resolverGrupoDeEscrita(sessao, 'grupo-x')).toEqual({ tipo: 'ok', valor: 'grupo-x' })
    expect(resolverGrupoDeEscrita(sessao, null)).toEqual({ tipo: 'ok', valor: null })
    expect(resolverGrupoDeEscrita(sessao, undefined)).toEqual({ tipo: 'ok', valor: null })
  })

  it('escopo grupo sem grupo pedido grava o grupo da sessão', () => {
    const sessao = { escopo: 'grupo' as const, grupoId: 'grupo-a' }
    expect(resolverGrupoDeEscrita(sessao, null)).toEqual({ tipo: 'ok', valor: 'grupo-a' })
    expect(resolverGrupoDeEscrita(sessao, undefined)).toEqual({ tipo: 'ok', valor: 'grupo-a' })
  })

  it('escopo grupo pedindo o PRÓPRIO grupo é aceito (idempotente)', () => {
    const sessao = { escopo: 'grupo' as const, grupoId: 'grupo-a' }
    expect(resolverGrupoDeEscrita(sessao, 'grupo-a')).toEqual({ tipo: 'ok', valor: 'grupo-a' })
  })

  it('escopo grupo pedindo o grupo de OUTRA sessão é recusado — nunca atravessa para o INSERT', () => {
    const sessao = { escopo: 'grupo' as const, grupoId: 'grupo-a' }
    const r = resolverGrupoDeEscrita(sessao, 'grupo-b')
    expect(ehErro(r)).toBe(true)
    if (ehErro(r)) expect(r.erro.codigo).toBe('GRUPO_CRUZADO')
  })

  it('propriedade: para escopo grupo, o valor resolvido NUNCA é um grupo diferente do da sessão', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.option(fc.string({ minLength: 1 })), (grupoDaSessao, pedido) => {
        const sessao = { escopo: 'grupo' as const, grupoId: grupoDaSessao }
        const r = resolverGrupoDeEscrita(sessao, pedido)
        if (ehOk(r)) expect(r.valor).toBe(grupoDaSessao)
      }),
    )
  })
})

describe('validarResponsavelDoMesmoGrupo', () => {
  it('sem responsável informado, sempre ok', () => {
    expect(ehOk(validarResponsavelDoMesmoGrupo({ escopo: 'grupo', grupoId: 'a' }, 'a', null, null))).toBe(true)
  })

  it('escopo geral nunca recusa, mesmo com grupos diferentes', () => {
    expect(
      ehOk(validarResponsavelDoMesmoGrupo({ escopo: 'geral', grupoId: null }, 'a', 'usuario-1', 'b')),
    ).toBe(true)
  })

  it('escopo grupo recusa responsável de outro grupo', () => {
    const r = validarResponsavelDoMesmoGrupo({ escopo: 'grupo', grupoId: 'a' }, 'a', 'usuario-1', 'b')
    expect(ehErro(r)).toBe(true)
    if (ehErro(r)) expect(r.erro.codigo).toBe('RESPONSAVEL_DE_OUTRO_GRUPO')
  })

  it('escopo grupo aceita responsável do mesmo grupo', () => {
    expect(
      ehOk(validarResponsavelDoMesmoGrupo({ escopo: 'grupo', grupoId: 'a' }, 'a', 'usuario-1', 'a')),
    ).toBe(true)
  })
})

describe('proximoPrazoDaRotina', () => {
  it('diaria soma um dia', () => {
    expect(proximoPrazoDaRotina('diaria', '2026-11-05')).toBe('2026-11-06')
  })

  it('semanal soma sete dias', () => {
    expect(proximoPrazoDaRotina('semanal', '2026-11-05')).toBe('2026-11-12')
  })

  it('mensal em dia 31 cai no último dia do mês curto (regra 25) e volta ao 31 quando o mês permite', () => {
    expect(proximoPrazoDaRotina('mensal', '2026-01-31', 31)).toBe('2026-02-28')
    // A âncora (31) é repassada pelo chamador, NUNCA lida da referência
    // anterior (28) — é o que evita ficar presa no dia 28 para sempre.
    expect(proximoPrazoDaRotina('mensal', '2026-02-28', 31)).toBe('2026-03-31')
  })

  it('sem âncora explícita, usa o dia da própria referência (primeira geração)', () => {
    expect(proximoPrazoDaRotina('mensal', '2026-01-15')).toBe('2026-02-15')
  })
})

describe('semanaIsoCivil', () => {
  it('casos conhecidos', () => {
    // 2026-01-01 é quinta-feira — semana 1 de 2026.
    expect(semanaIsoCivil('2026-01-01')).toBe('2026-W01')
    // 2025-12-29 é segunda-feira da mesma semana ISO que 2026-01-01.
    expect(semanaIsoCivil('2025-12-29')).toBe('2026-W01')
    expect(semanaIsoCivil('2026-11-05')).toBe('2026-W45')
  })
})

describe('podeEditarCheckinDaSemana', () => {
  it('só a semana corrente pode ser editada', () => {
    const agora = new Date('2026-11-05T12:00:00Z')
    expect(podeEditarCheckinDaSemana('2026-W45', agora, 'UTC')).toBe(true)
    expect(podeEditarCheckinDaSemana('2026-W44', agora, 'UTC')).toBe(false)
    expect(podeEditarCheckinDaSemana('2026-W46', agora, 'UTC')).toBe(false)
  })
})

describe('saudeAtualDoCliente — derivada, nunca campo', () => {
  it('sem checkin nenhum, null', () => {
    expect(saudeAtualDoCliente([])).toBeNull()
  })

  it('o mais recente por semana vence, independente da ordem de entrada', () => {
    const checkins = [
      { semana: '2026-W40', saude: 'bom' as const },
      { semana: '2026-W45', saude: 'critico' as const },
      { semana: '2026-W42', saude: 'atencao' as const },
    ]
    expect(saudeAtualDoCliente(checkins)).toBe('critico')
  })
})

describe('roteiroDaEtapa — ROT_ETAPA do protótipo (L2446)', () => {
  it('dá o roteiro de cada etapa, e "agendar" para as terminais', () => {
    const esperado: Record<EtapaDoLead, string> = {
      novo: 'primeiro',
      contato: 'agendar',
      reuniao: 'diagnostico',
      proposta: 'proposta',
      espera: 'retomada',
      ganho: 'agendar',
      perdido: 'agendar',
    }
    for (const etapa of ETAPAS_DO_LEAD) expect(roteiroDaEtapa(etapa)).toBe(esperado[etapa])
  })
})

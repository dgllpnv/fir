import { describe, expect, it } from 'vitest'
import { abrirAbaDeSuporte, TEXTO_SUPORTE_BLOQUEADO } from './suporte'

describe('abrirAbaDeSuporte', () => {
  it('aba aberta: sem aviso de bloqueio, e o vínculo com esta aba é cortado', () => {
    const aba = { opener: 'esta-janela' as unknown }
    expect(abrirAbaDeSuporte(() => aba)).toBe('aberta')
    expect(aba.opener).toBeNull()
  })

  it('null (pop-up realmente barrado): bloqueada', () => {
    expect(abrirAbaDeSuporte(() => null)).toBe('bloqueada')
  })

  it('o aviso de bloqueio nomeia a clínica', () => {
    expect(TEXTO_SUPORTE_BLOQUEADO('CLI1')).toContain('CLI1')
  })
})

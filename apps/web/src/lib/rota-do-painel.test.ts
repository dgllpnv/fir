import { describe, expect, it } from 'vitest'
import { clinicaDaRota, ehPortaDoPainel } from './rota-do-painel'

/**
 * A faixa do painel diz **em qual clínica se está agindo**, e quem responde
 * essa pergunta é esta função — a partir do endereço, não de um estado que
 * alguém se lembra de atualizar.
 *
 * Por que isto tem teste próprio: no painel, "a clínica errada" é a clínica de
 * outra pessoa. Uma função que devolvesse a clínica da tela anterior faria a
 * faixa afirmar com confiança algo falso, que é pior que não afirmar nada.
 */
describe('a clínica em que o painel está agindo vem do endereço', () => {
  it('a lista não age em clínica nenhuma', () => {
    expect(clinicaDaRota('/superadmin/clinicas')).toBe(null)
    expect(clinicaDaRota('/superadmin/clinicas/')).toBe(null)
    expect(clinicaDaRota('/superadmin')).toBe(null)
    expect(clinicaDaRota('/superadmin/entrar')).toBe(null)
  })

  it('a tela de pessoas age na clínica do endereço', () => {
    expect(clinicaDaRota('/superadmin/clinicas/9f3c1a2e/pessoas')).toBe('9f3c1a2e')
    expect(clinicaDaRota('/superadmin/clinicas/9f3c1a2e')).toBe('9f3c1a2e')
    expect(clinicaDaRota('/superadmin/clinicas/9f3c1a2e/')).toBe('9f3c1a2e')
  })

  it('o segmento é decodificado, porque ele vem da URL', () => {
    expect(clinicaDaRota('/superadmin/clinicas/a%20b/pessoas')).toBe('a b')
    // `%` solto não é escape válido: `decodeURIComponent` lança, e a resposta
    // certa é "não sei qual clínica" — nunca derrubar a faixa inteira.
    expect(clinicaDaRota('/superadmin/clinicas/%/pessoas')).toBe(null)
  })

  it('nenhuma tela do PRODUTO age numa clínica do painel', () => {
    // O painel e o produto compartilham o `layout` raiz. Casar `/clinicas` sem
    // o prefixo faria a faixa aparecer sobre a tela da clínica.
    expect(clinicaDaRota('/clinicas/9f3c1a2e')).toBe(null)
    expect(clinicaDaRota('/hoje')).toBe(null)
    expect(clinicaDaRota('/entrar')).toBe(null)
    // Prefixo parecido, rota diferente.
    expect(clinicaDaRota('/superadmin/clinicasx/9f3c')).toBe(null)
    // Casa o prefixo sem casar a ROTA. Um `startsWith` sem a barra devolve
    // `'xy'` aqui — segmento que não é clínica de ninguém, afirmado como se
    // fosse.
    expect(clinicaDaRota('/superadmin/clinicasxy/9f3c')).toBe(null)
  })
})

describe('a porta do painel não tem faixa', () => {
  it('entrar e trocar a senha são portas', () => {
    expect(ehPortaDoPainel('/superadmin/entrar')).toBe(true)
    expect(ehPortaDoPainel('/superadmin/trocar-senha')).toBe(true)
    expect(ehPortaDoPainel('/superadmin/entrar/')).toBe(true)
  })

  it('as telas de operação não são', () => {
    expect(ehPortaDoPainel('/superadmin/clinicas')).toBe(false)
    expect(ehPortaDoPainel('/superadmin/clinicas/9f3c/pessoas')).toBe(false)
    expect(ehPortaDoPainel('/superadmin')).toBe(false)
  })
})

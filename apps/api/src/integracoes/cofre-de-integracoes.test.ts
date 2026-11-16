import { describe, expect, it } from 'vitest'
import {
  AberturaDeIntegracoes,
  SeloDeIntegracoes,
  gerarParDeChavesDeIntegracoes,
} from './cofre-de-integracoes'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const TOKEN = 'medx_tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

function cofre() {
  const par = gerarParDeChavesDeIntegracoes()
  const pepper = 'pepper-de-teste-com-mais-de-32-caracteres-xx'
  return {
    selo: new SeloDeIntegracoes({ chavePublica: par.publica, pepper }),
    abertura: new AberturaDeIntegracoes({ chavePrivada: par.privada }),
  }
}

describe('cofre das integrações (gate S-2, S-3, S-6)', () => {
  it('o que a API sela, só o worker abre — e volta igual', () => {
    const { selo, abertura } = cofre()
    const s = selo.selar(A, 'medx', TOKEN)
    expect(s.cifrado.includes(Buffer.from(TOKEN))).toBe(false)
    expect(abertura.abrir(A, 'medx', s.cifrado, s.versao)).toBe(TOKEN)
  })

  it('o selado da clínica A copiado para a B não abre (AAD com o id do contexto)', () => {
    const { selo, abertura } = cofre()
    const s = selo.selar(A, 'medx', TOKEN)
    expect(abertura.abrir(B, 'medx', s.cifrado, s.versao)).toBeNull()
  })

  it('versão errada, bytes adulterados ou lixo não abrem, e não lançam', () => {
    const { selo, abertura } = cofre()
    const s = selo.selar(A, 'medx', TOKEN)
    expect(abertura.abrir(A, 'medx', s.cifrado, s.versao + 1)).toBeNull()
    const adulterado = Buffer.from(s.cifrado)
    adulterado[adulterado.length - 1] = adulterado[adulterado.length - 1]! ^ 1
    expect(abertura.abrir(A, 'medx', adulterado, s.versao)).toBeNull()
    expect(abertura.abrir(A, 'medx', Buffer.alloc(10), s.versao)).toBeNull()
  })

  it('outra chave privada não abre', () => {
    const { selo } = cofre()
    const outra = cofre().abertura
    const s = selo.selar(A, 'medx', TOKEN)
    expect(outra.abrir(A, 'medx', s.cifrado, s.versao)).toBeNull()
  })

  it('cada selagem é diferente (chave efêmera), a impressão é estável e separa tokens', () => {
    const { selo } = cofre()
    const s1 = selo.selar(A, 'medx', TOKEN)
    const s2 = selo.selar(A, 'medx', TOKEN)
    expect(s1.cifrado.equals(s2.cifrado)).toBe(false)
    expect(selo.impressao('medx', TOKEN)).toBe(selo.impressao('medx', TOKEN))
    expect(selo.impressao('medx', TOKEN)).not.toBe(selo.impressao('medx', TOKEN + 'x'))
    expect(selo.impressao('medx', TOKEN)).toMatch(/^[0-9a-f]{64}$/)
    expect(selo.impressao('medx', TOKEN)).not.toContain(TOKEN)
  })

  it('o final da chave mostra só os 4 últimos caracteres', () => {
    expect(SeloDeIntegracoes.finalDaChave(TOKEN)).toBe('6789')
  })

  it('em produção, sem as variáveis, a subida falha', () => {
    const prod = { NODE_ENV: 'production' } as NodeJS.ProcessEnv
    expect(() => SeloDeIntegracoes.doAmbiente(prod)).toThrow(/FIR_INTEGRACOES/)
    expect(() => AberturaDeIntegracoes.doAmbiente(prod)).toThrow(/FIR_INTEGRACOES/)
  })
})

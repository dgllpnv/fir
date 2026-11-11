import { describe, expect, it } from 'vitest'
import { CriarPessoaEntrada, PessoaNaLista } from './pessoas'

const PERFIL = '11111111-1111-4111-8111-111111111111'
const BASE = { nome: 'Ana Lima', usuario: 'ana.lima', funcao: 'Recepção' }

/**
 * O corpo de criar pessoa é DISCRIMINADO: `acesso` (novo) ou `perfilId` (legado,
 * até o web migrar), nunca os dois e nunca nenhum — o corpo ambíguo é 400 (A-13).
 */
describe('CriarPessoaEntrada', () => {
  it('aceita acesso de administradora', () => {
    const r = CriarPessoaEntrada.safeParse({ ...BASE, acesso: { admin: true } })
    expect(r.success && r.data.acesso).toEqual({ admin: true })
  })

  it('aceita acesso por perfil', () => {
    const r = CriarPessoaEntrada.safeParse({ ...BASE, acesso: { admin: false, perfilId: PERFIL } })
    expect(r.success && r.data.acesso).toEqual({ admin: false, perfilId: PERFIL })
  })

  it('o perfilId legado vira acesso por perfil', () => {
    const r = CriarPessoaEntrada.safeParse({ ...BASE, perfilId: PERFIL })
    expect(r.success && r.data.acesso).toEqual({ admin: false, perfilId: PERFIL })
  })

  it('recusa corpo ambíguo: acesso e perfilId juntos', () => {
    expect(
      CriarPessoaEntrada.safeParse({ ...BASE, perfilId: PERFIL, acesso: { admin: true } }).success,
    ).toBe(false)
  })

  it('recusa corpo sem nenhum dos dois', () => {
    expect(CriarPessoaEntrada.safeParse(BASE).success).toBe(false)
  })

  it('recusa admin com perfil, e perfil sem id', () => {
    expect(
      CriarPessoaEntrada.safeParse({ ...BASE, acesso: { admin: true, perfilId: PERFIL } }).success,
    ).toBe(false)
    expect(CriarPessoaEntrada.safeParse({ ...BASE, acesso: { admin: false } }).success).toBe(false)
  })

  it('continua sem senha e sem clinicaId (.strict)', () => {
    expect(
      CriarPessoaEntrada.safeParse({ ...BASE, acesso: { admin: true }, senha: 'x' }).success,
    ).toBe(false)
    expect(
      CriarPessoaEntrada.safeParse({ ...BASE, acesso: { admin: true }, clinicaId: PERFIL }).success,
    ).toBe(false)
  })

  it('admin: true solto no corpo (mass assignment) é recusado', () => {
    expect(CriarPessoaEntrada.safeParse({ ...BASE, perfilId: PERFIL, admin: true }).success).toBe(
      false,
    )
  })
})

describe('PessoaNaLista.avisoDeAdministradora', () => {
  const linha = {
    id: PERFIL,
    nome: 'Ana',
    usuario: 'ana',
    funcao: '',
    admin: true,
    perfilId: null,
    ativo: true,
    aguardandoPrimeiroAcesso: false,
    provisoriaExpiraEm: null,
    euMesma: false,
  }

  it('leva só quem fez e quando — nada além', () => {
    const r = PessoaNaLista.safeParse({
      ...linha,
      avisoDeAdministradora: { acao: 'criada', por: 'Firmare (suporte)', em: '2026-11-10T12:00:00.000Z' },
    })
    expect(r.success).toBe(true)
    expect(
      PessoaNaLista.safeParse({
        ...linha,
        avisoDeAdministradora: { acao: 'criada', por: 'X', em: '2026-11-10T12:00:00.000Z', usuario: 'x' },
      }).success,
    ).toBe(false)
  })

  it('é opcional-nulo: quem não é administradora recente vem com null', () => {
    expect(PessoaNaLista.safeParse({ ...linha, avisoDeAdministradora: null }).success).toBe(true)
  })
})

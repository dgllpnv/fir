import { EditarProcedimento, SalvarProcedimento } from '@fir/contracts'
import { describe, expect, it } from 'vitest'
import { corpoDoProcedimento, type FormularioDoProcedimento } from './corpo-do-procedimento'

/**
 * O corpo que Configurações › Procedimentos manda, contra o contrato de VERDADE.
 *
 * Defeito em produção até 2026-11-18, visto por duas clínicas no mesmo dia: a
 * tela mandava `null` em `valorPorSessao` (valor vazio) e em `retorno`
 * ("Contato de retorno? Não") também na CRIAÇÃO, onde o contrato só aceita o
 * campo ausente. Criar um procedimento sem valor, ou sem retorno, nunca
 * funcionou. Na edição o `null` é o que limpa o campo, e tem de continuar indo.
 */
const form = (m: Partial<FormularioDoProcedimento> = {}): FormularioDoProcedimento => ({
  nome: 'Tirzepatida',
  sessoes: 1,
  intervalo: 7,
  rotulo: 'Sessão',
  responsavelId: '',
  valor: null,
  retorno: null,
  ativo: true,
  ...m,
})

const retorno = { quantidade: 3, unidade: 'm' as const, antecedenciaDias: 4 }
const RESPONSAVEL = '11111111-1111-4111-8111-111111111111'

const combinacoes = [
  ['sem valor, retorno Não', form()],
  ['sem valor, retorno Sim (foto 1)', form({ retorno })],
  ['valor 300,00, retorno Não (foto 2)', form({ valor: 30000n })],
  ['valor e retorno', form({ valor: 30000n, retorno, responsavelId: RESPONSAVEL })],
] as const

describe('corpoDoProcedimento — criar', () => {
  it.each(combinacoes)('%s passa no contrato da criação', (_, f) => {
    const r = SalvarProcedimento.safeParse(corpoDoProcedimento(f, { tipo: 'criar' }))
    expect(r.success ? 'ok' : r.error.issues[0]?.message).toBe('ok')
  })

  it('o que foi digitado chega ao servidor', () => {
    const r = SalvarProcedimento.parse(
      corpoDoProcedimento(form({ valor: 30000n, retorno, responsavelId: RESPONSAVEL, ativo: false }), {
        tipo: 'criar',
      }),
    )
    expect(r.valorPorSessao).toBe(30000n)
    expect(r.retorno).toEqual({ ...retorno, responsavelId: null })
    expect(r.responsavelId).toBe(RESPONSAVEL)
    expect(r.ativo).toBe(false)
  })

  it('valor vazio e retorno Não ficam de fora — não são null', () => {
    const c = corpoDoProcedimento(form(), { tipo: 'criar' })
    expect(c).not.toHaveProperty('valorPorSessao')
    expect(c).not.toHaveProperty('retorno')
    expect(c).not.toHaveProperty('responsavelId')
  })
})

describe('corpoDoProcedimento — editar', () => {
  it.each(combinacoes)('%s passa no contrato da edição', (_, f) => {
    const r = EditarProcedimento.safeParse(corpoDoProcedimento(f, { tipo: 'editar', valorGravado: '30000' }))
    expect(r.success ? 'ok' : r.error.issues[0]?.message).toBe('ok')
  })

  it('marcar "Não" no retorno limpa o retorno gravado', () => {
    const c = corpoDoProcedimento(form(), { tipo: 'editar', valorGravado: null })
    expect(c.retorno).toBeNull()
  })

  it('apagar o valor que estava gravado limpa o valor', () => {
    const c = corpoDoProcedimento(form(), { tipo: 'editar', valorGravado: '30000' })
    expect(c.valorPorSessao).toBeNull()
  })

  it('quem não vê o valor (chega null) e salva não apaga o preço gravado', () => {
    // Sem `valores`, a lista traz `valorPorSessao: null` e o campo abre vazio.
    // Mandar `null` apagaria o preço que a pessoa nunca viu.
    const c = corpoDoProcedimento(form(), { tipo: 'editar', valorGravado: null })
    expect(c).not.toHaveProperty('valorPorSessao')
  })

  it('tirar o responsável limpa o responsável', () => {
    const c = corpoDoProcedimento(form(), { tipo: 'editar', valorGravado: null })
    expect(c.responsavelId).toBeNull()
  })
})

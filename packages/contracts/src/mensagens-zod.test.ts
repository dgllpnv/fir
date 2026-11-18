import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { EditarProcedimento, SalvarProcedimento, Uuid } from './index'

/**
 * A mensagem que sai do contrato chega à tela da clínica: "Expected object,
 * received null" saiu em produção (2026-11-18) e a clínica não soube o que
 * fazer. As mensagens padrão do Zod saem em português, e as que já escrevemos
 * continuam como estão.
 */
const mensagem = (r: { success: boolean; error?: z.ZodError }) => r.error?.issues[0]?.message

const base = {
  nome: 'Tirzepatida',
  sessoesSugeridas: 1,
  intervaloSugeridoDias: 7,
}

describe('mensagens do contrato em português', () => {
  it('null num campo que não o aceita diz o campo, em português', () => {
    expect(mensagem(SalvarProcedimento.safeParse({ ...base, retorno: null }))).toBe(
      'O campo "contato de retorno" não pode ficar vazio.',
    )
  })

  it('campo obrigatório ausente', () => {
    expect(mensagem(SalvarProcedimento.safeParse({ sessoesSugeridas: 1, intervaloSugeridoDias: 7 }))).toBe(
      'O campo "nome" é obrigatório.',
    )
  })

  it('tipo errado', () => {
    expect(mensagem(SalvarProcedimento.safeParse({ ...base, sessoesSugeridas: 'quatro' }))).toBe(
      'O campo "sessões sugeridas" precisa ser um número.',
    )
  })

  it('número fora do limite diz o limite', () => {
    expect(mensagem(SalvarProcedimento.safeParse({ ...base, sessoesSugeridas: 0 }))).toBe(
      'O campo "sessões sugeridas" precisa ser no mínimo 1.',
    )
    expect(mensagem(SalvarProcedimento.safeParse({ ...base, intervaloSugeridoDias: 181 }))).toBe(
      'O campo "intervalo sugerido (dias)" precisa ser no máximo 180.',
    )
  })

  it('texto curto demais', () => {
    expect(mensagem(SalvarProcedimento.safeParse({ ...base, nome: '   ' }))).toBe(
      'O campo "nome" não pode ficar vazio.',
    )
  })

  it('identificador inválido não sai como "Invalid uuid"', () => {
    expect(mensagem(Uuid.safeParse('x'))).toBe('Identificador inválido.')
  })

  it('opção fora da lista', () => {
    const r = EditarProcedimento.safeParse({
      retorno: { unidade: 'semanas', quantidade: 1 },
    })
    expect(mensagem(r)).toBe('O campo "unidade" tem uma opção que não existe.')
  })

  it('a mensagem que escrevemos não é trocada', () => {
    expect(mensagem(SalvarProcedimento.safeParse({ ...base, valorPorSessao: '0' }))).toBe(
      'informe um valor em centavos maior que zero',
    )
  })

  it('nenhuma mensagem padrão do Zod em inglês sobra', () => {
    const casos = [
      SalvarProcedimento.safeParse({ ...base, retorno: null }),
      SalvarProcedimento.safeParse({ ...base, ativo: 'sim' }),
      SalvarProcedimento.safeParse({ ...base, descartaveis: 'nada' }),
      SalvarProcedimento.safeParse(null),
    ]
    for (const r of casos) {
      expect(mensagem(r)).not.toMatch(/Expected|Required|Invalid|must|received/)
    }
  })
})
